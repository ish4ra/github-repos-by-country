import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { COUNTRIES } from '../src/countries.js';
import { loadCountryConfig, projectRoot } from '../src/config.js';
import { GitHubGraphQLClient } from '../src/github.js';
import {
  createCollector,
  ingestDiscoveryPage,
} from '../src/ranking.js';
import {
  addUnresolvedShard,
  beginActiveTerm,
  candidatePoolThreshold,
  createDiscoveryState,
  finishActiveTerm,
  mergeCandidatePools,
  prepareDiscoveryState,
  serializeProbeCandidates,
  DEFAULT_CANDIDATE_POOL_LIMIT,
} from '../src/discovery-state.js';
import {
  expandSearchWorkItem,
  isSearchPageCapped,
} from '../src/search-shards.js';
import { normalizeLocationForComparison } from '../src/location.js';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN or GH_TOKEN is required.');

const requestBudget = clampInt(process.env.DISCOVERY_REQUEST_LIMIT, 400, 20, 600);
const countryRequestSlice = clampInt(
  process.env.COUNTRY_REQUEST_SLICE,
  8,
  1,
  50,
);
const candidatePoolLimit = clampInt(
  process.env.CANDIDATE_POOL_LIMIT,
  DEFAULT_CANDIDATE_POOL_LIMIT,
  100,
  1000,
);
const pageSize = clampInt(process.env.DISCOVERY_PAGE_SIZE, 50, 10, 100);
const maxLeafPages = Math.max(1, Math.ceil(1000 / pageSize));
const rateLimitReserve = clampInt(process.env.RATE_LIMIT_RESERVE, 120, 50, 400);
const runtimeBudgetMs = clampInt(
  process.env.DISCOVERY_RUNTIME_MINUTES,
  42,
  5,
  48,
) * 60 * 1000;
const startedAtMs = Date.now();

const root = projectRoot();
const stateDir = path.join(root, 'state', 'discovery');
const checkpointPath = path.join(root, 'state', 'global-checkpoint.json');
await mkdir(stateDir, { recursive: true });

const rolloutOrder = [
  'LK',
  ...COUNTRIES.map((country) => country.code).filter((code) => code !== 'LK'),
];

let checkpoint = await readJson(checkpointPath, {
  schemaVersion: 2,
  cycle: 1,
  countryIndex: 0,
  updatedAt: new Date().toISOString(),
});

if (checkpoint.countryIndex >= rolloutOrder.length) {
  checkpoint = {
    ...checkpoint,
    schemaVersion: 3,
    round: (checkpoint.round || 1) + 1,
    countryIndex: 0,
    updatedAt: new Date().toISOString(),
  };
}

let requestsUsed = 0;
let minimumRateLimitRemaining = null;
let stopReason = null;
let countriesTouched = 0;

while (
  checkpoint.countryIndex < rolloutOrder.length &&
  requestsUsed < requestBudget &&
  !runtimeExpired()
) {
  const code = rolloutOrder[checkpoint.countryIndex];
  const config = await loadCountryConfig(code);

  if (!config.geographySearchTerms.length) {
    console.warn(`[${code}] no generated geography terms; advancing without publishing.`);
    checkpoint.countryIndex += 1;
    continue;
  }

  const terms = buildDiscoveryTerms(config);
  const statePath = path.join(stateDir, `${code}.json`);
  const existing = await readJson(statePath, null);
  const effectiveCountrySlice = existing ? countryRequestSlice : 1;
  const crawlCycle = existing?.cycle || 1;
  let state = prepareDiscoveryState(existing, config, terms, crawlCycle);
  if (!state) state = createDiscoveryState(config, terms, crawlCycle);

  state.candidatePoolLimit = candidatePoolLimit;
  countriesTouched += 1;

  if (state.phase === 'complete') {
    advanceCountry(checkpoint, rolloutOrder.length);
    continue;
  }

  const countryRequestStart = requestsUsed;

  const client = new GitHubGraphQLClient({
    token,
    requestDelayMs: config.requestDelayMs,
  });

  if (state.phase === 'finalize' || state.nextTermIndex >= terms.length) {
    state.phase = 'complete';
    state.discoveryComplete = true;
    state.completedAt ||= new Date().toISOString();
    state.finalizedAt ||= state.completedAt;
    state.updatedAt = new Date().toISOString();
    await writeJson(statePath, state);
    checkpoint.countryIndex += 1;
    console.log(
      `[${code}] secondary owner-discovery coverage complete; public ranking remains owned by repository-first certification.`,
    );
    continue;
  }

  while (
    state.nextTermIndex < terms.length &&
    requestsUsed < requestBudget &&
    requestsUsed - countryRequestStart < effectiveCountrySlice &&
    !runtimeExpired()
  ) {
    const term = terms[state.nextTermIndex];
    const active = beginActiveTerm(state, term);

    if (!active.queue.length) {
      finishActiveTerm(state);
      await writeJson(statePath, state);
      continue;
    }

    const work = active.queue.shift();

    let page;
    try {
      page = await client.discoverOwnersPage({
        searchQuery: work.query,
        first: pageSize,
        cursor: work.cursor || null,
        includeTopRepository: true,
      });
      requestsUsed += 1;
      active.requests += 1;
      state.stats.searchRequests += 1;
      trackRateLimit(state, page.rateLimit);
      minimumRateLimitRemaining = minFinite(
        minimumRateLimitRemaining,
        page.rateLimit?.remaining,
      );
    } catch (error) {
      work.attempts = Number(work.attempts || 0) + 1;
      work.lastError = String(error?.message || error);
      work.lastAttemptAt = new Date().toISOString();

      if (work.attempts < 3) {
        active.queue.unshift(work);
        stopReason = 'query-retry-deferred';
        console.warn(
          `[${code}] deferred failed shard for next run after client retries: ${work.query}`,
        );
      } else {
        addUnresolvedShard(state, {
          term: active.term,
          query: work.query,
          reason: 'query-failed-after-worker-retries',
          error: work.lastError,
        });
        console.warn(
          `[${code}] recorded unresolved shard after repeated failures: ${work.query}`,
        );
      }

      await writeJson(statePath, state);
      if (stopReason) break;
      continue;
    }

    const pageCollector = createCollector(config);
    ingestDiscoveryPage(pageCollector, {
      searchTerm: active.term,
      pageNumber: work.pageNumber || 1,
      page,
    });

    state.stats.rawOwnerHits += page.nodes?.length || 0;
    state.stats.acceptedOwnerHits += pageCollector.owners.size;
    state.stats.rejectedOwnerHits += pageCollector.rejectedOwners.size;

    const pageCandidates = serializeProbeCandidates(pageCollector);
    state.candidates = mergeCandidatePools(
      state.candidates,
      pageCandidates,
      candidatePoolLimit,
    );
    state.candidatePoolThresholdStars = candidatePoolThreshold(
      state.candidates,
      candidatePoolLimit,
    );

    if (!work.cursor && isSearchPageCapped(page)) {
      const children = expandSearchWorkItem(work);

      if (children.length > 0) {
        active.shardExpansions += 1;
        state.stats.shardExpansions += 1;
        active.reportedCount = page.userCount || active.reportedCount;
        active.queue.unshift(...children);
        console.log(
          `[${code}] ${active.term}: split ${work.stage} shard with ${page.userCount} results into ${children.length} resumable shard(s).`,
        );
      } else {
        addUnresolvedShard(state, {
          term: active.term,
          query: work.query,
          reportedCount: page.userCount || 0,
          reason: 'search-cap-after-final-shard',
        });
      }
    } else {
      active.leafPages += 1;
      state.stats.leafPages += 1;

      if (page.pageInfo?.hasNextPage) {
        if ((work.pageNumber || 1) < maxLeafPages && page.pageInfo.endCursor) {
          active.queue.unshift({
            ...work,
            cursor: page.pageInfo.endCursor,
            pageNumber: (work.pageNumber || 1) + 1,
            attempts: 0,
            lastError: undefined,
            lastAttemptAt: undefined,
          });
        } else {
          addUnresolvedShard(state, {
            term: active.term,
            query: work.query,
            reportedCount: page.userCount || 0,
            reason: 'leaf-page-window-exhausted',
          });
        }
      }
    }

    state.updatedAt = new Date().toISOString();
    await writeJson(statePath, state);

    if (
      Number.isFinite(minimumRateLimitRemaining) &&
      minimumRateLimitRemaining < rateLimitReserve
    ) {
      stopReason = 'rate-limit-reserve';
      console.warn(
        `[${code}] stopping safely with ${minimumRateLimitRemaining} GraphQL points remaining.`,
      );
      break;
    }

    if (!active.queue.length) {
      console.log(
        `[${code}] completed geography term ${state.nextTermIndex + 1}/${terms.length}: ${active.term}`,
      );
      finishActiveTerm(state);
      await writeJson(statePath, state);
    }
  }

  if (stopReason === 'rate-limit-reserve' || runtimeExpired() || requestsUsed >= requestBudget) {
    if (!stopReason) {
      stopReason = runtimeExpired() ? 'runtime-budget' : 'request-budget';
    }
    await writeJson(statePath, state);
    break;
  }

  if (stopReason === 'query-retry-deferred') {
    stopReason = null;
  }

  if (state.nextTermIndex >= terms.length) {
    state.phase = 'complete';
    state.discoveryComplete = true;
    state.completedAt ||= new Date().toISOString();
    state.finalizedAt ||= state.completedAt;
    state.updatedAt = new Date().toISOString();
    await writeJson(statePath, state);
    checkpoint.countryIndex += 1;
    if (checkpoint.countryIndex >= rolloutOrder.length) {
      checkpoint.round = (checkpoint.round || 1) + 1;
      checkpoint.countryIndex = 0;
    }
    continue;
  }

  await writeJson(statePath, state);
  advanceCountry(checkpoint, rolloutOrder.length);
}

checkpoint.schemaVersion = 3;
checkpoint.updatedAt = new Date().toISOString();
checkpoint.lastRun = {
  requestBudget,
  requestsUsed,
  countriesTouched,
  countryRequestSlice,
  stopReason: stopReason || 'batch-complete',
  minimumRateLimitRemaining,
  runtimeSeconds: Math.round((Date.now() - startedAtMs) / 1000),
};
await writeJson(checkpointPath, checkpoint);

console.log(
  `Global discovery batch finished: round=${checkpoint.round || 1}, nextCountryIndex=${checkpoint.countryIndex}, requests=${requestsUsed}/${requestBudget}, countries=${countriesTouched}, stop=${checkpoint.lastRun.stopReason}.`,
);

function buildDiscoveryTerms(config) {
  const ambiguous = config.ambiguousLocationTermLookup || new Set();
  const terms = new Map();

  for (const value of [...config.searchTerms, ...config.geographySearchTerms]) {
    const raw = String(value || '').trim();
    if (!raw) continue;

    const normalized = normalizeLocationForComparison(raw);
    if (!normalized) continue;

    const isExplicitCountry = config.countryAliases.some(
      (alias) => normalizeLocationForComparison(alias) === normalized,
    );
    if (!isExplicitCountry && ambiguous.has(normalized)) continue;

    if (!terms.has(normalized)) terms.set(normalized, raw);
  }

  return [...terms.values()];
}

function trackRateLimit(state, rateLimit) {
  const remaining = rateLimit?.remaining;
  if (!Number.isFinite(remaining)) return;

  state.stats.minimumRateLimitRemaining = minFinite(
    state.stats.minimumRateLimitRemaining,
    remaining,
  );
}

function runtimeExpired(reserveMs = 0) {
  return Date.now() - startedAtMs >= runtimeBudgetMs - reserveMs;
}

function minFinite(a, b) {
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : null;
  if (!Number.isFinite(b)) return a;
  return Math.min(a, b);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function advanceCountry(checkpoint, totalCountries) {
  checkpoint.countryIndex += 1;
  if (checkpoint.countryIndex >= totalCountries) {
    checkpoint.round = (checkpoint.round || 1) + 1;
    checkpoint.countryIndex = 0;
  }
  checkpoint.updatedAt = new Date().toISOString();
}

function clampInt(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}
