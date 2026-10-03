import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { COUNTRIES } from '../src/countries.js';
import { loadCountryConfig, projectRoot } from '../src/config.js';
import { GitHubGraphQLClient } from '../src/github.js';
import {
  createCollector,
  ingestDiscoveryPage,
  selectCandidateOwners,
  buildRanking,
} from '../src/ranking.js';
import {
  addUnresolvedShard,
  beginActiveTerm,
  candidatePoolThreshold,
  createDiscoveryState,
  finishActiveTerm,
  hydrateCollectorFromCandidates,
  mergeCandidatePools,
  prepareDiscoveryState,
  serializeProbeCandidates,
  DEFAULT_CANDIDATE_POOL_LIMIT,
} from '../src/discovery-state.js';
import {
  expandSearchWorkItem,
  isSearchPageCapped,
} from '../src/search-shards.js';
import { fetchRepositoriesForOwners } from '../src/pipeline.js';
import { writeOutputs, writeRankingsIndex } from '../src/output.js';
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
    state.phase = 'finalize';
    state.discoveryComplete = true;
    state.completedAt ||= new Date().toISOString();

    if (canFinalize()) {
      await finalizeCountry(config, state, client);
      state.phase = 'complete';
      state.finalizedAt = new Date().toISOString();
      state.updatedAt = state.finalizedAt;
      await writeJson(statePath, state);
      checkpoint.countryIndex += 1;
      console.log(`[${code}] finalized; advancing to next country.`);
      continue;
    }

    await writeJson(statePath, state);
    advanceCountry(checkpoint, rolloutOrder.length);
    continue;
  }

  while (
    state.nextTermIndex < terms.length &&
    requestsUsed < requestBudget &&
    requestsUsed - countryRequestStart < countryRequestSlice &&
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
      const collector = createCollector(config);
      ingestDiscoveryPage(collector, {
        searchTerm: active.term,
        pageNumber: work.pageNumber || 1,
        page,
      });

      active.leafPages += 1;
      state.stats.leafPages += 1;
      state.stats.rawOwnerHits += page.nodes?.length || 0;
      state.stats.acceptedOwnerHits += collector.owners.size;
      state.stats.rejectedOwnerHits += collector.rejectedOwners.size;

      const freshCandidates = serializeProbeCandidates(collector);
      state.candidates = mergeCandidatePools(
        state.candidates,
        freshCandidates,
        candidatePoolLimit,
      );
      state.candidatePoolThresholdStars = candidatePoolThreshold(
        state.candidates,
        candidatePoolLimit,
      );

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
    state.phase = 'finalize';
    state.discoveryComplete = true;
    state.completedAt ||= new Date().toISOString();
    await writeJson(statePath, state);

    if (canFinalize()) {
      await finalizeCountry(config, state, client);
      state.phase = 'complete';
      state.finalizedAt = new Date().toISOString();
      state.updatedAt = state.finalizedAt;
      await writeJson(statePath, state);
      checkpoint.countryIndex += 1;
      continue;
    }

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
await writeRankingsIndex();

console.log(
  `Global discovery batch finished: round=${checkpoint.round || 1}, nextCountryIndex=${checkpoint.countryIndex}, requests=${requestsUsed}/${requestBudget}, countries=${countriesTouched}, stop=${checkpoint.lastRun.stopReason}.`,
);

async function finalizeCountry(config, state, client) {
  console.log(
    `[${config.code}] finalizing from safety pool of ${state.candidates.length} owner(s).`,
  );

  const collector = hydrateCollectorFromCandidates(config, state.candidates);
  const poolOwners = [...collector.owners.values()].filter((owner) => owner.id);

  await fetchRepositoriesForOwners({
    client,
    collector,
    owners: poolOwners,
    reposPerOwner: 1,
    batchSize: 50,
    stage: 'probe',
    countryCode: config.code,
    log: console,
  });

  const finalCandidates = selectCandidateOwners(collector, config.rankingLimit);

  await fetchRepositoriesForOwners({
    client,
    collector,
    owners: finalCandidates,
    reposPerOwner: config.candidateRepositoriesPerOwner,
    batchSize: 5,
    stage: 'candidate',
    countryCode: config.code,
    log: console,
  });

  const ranking = buildRanking(collector);
  ranking.methodologyVersion = '0.5.0-resumable-global-crawl';
  ranking.coverage.status =
    state.unresolvedShards.length === 0
      ? 'global-geography-crawl'
      : 'global-geography-crawl-with-gaps';
  ranking.coverage.ownerMetricLabel = 'Retained candidate owners';
  ranking.coverage.geography = {
    source: config.geography?.source || null,
    counts: config.geography?.counts || null,
    termsTotal: state.geography.termsTotal,
    termsProcessed: state.nextTermIndex,
    crawlCycle: state.cycle,
    crawlStartedAt: state.startedAt,
    crawlCompletedAt: state.completedAt || new Date().toISOString(),
    unresolvedShardCount: state.unresolvedShards.length,
  };
  ranking.coverage.candidateSafetyPool = {
    retainedOwners: state.candidates.length,
    configuredLimit: state.candidatePoolLimit || DEFAULT_CANDIDATE_POOL_LIMIT,
    thresholdStars: state.candidatePoolThresholdStars,
  };
  ranking.coverage.discoveryTotals = state.stats;
  ranking.coverage.unresolvedShards = state.unresolvedShards;
  ranking.coverage.notes = [
    'Country attribution uses the generated global country/city/admin geography index plus explicit country aliases.',
    'Ambiguous city/admin names shared by multiple countries are not accepted as city-only evidence.',
    'Broad GitHub user searches are deterministically sharded when they exceed GitHub search result windows.',
    'Search shard queues and page cursors are persisted so large terms can resume across workflow runs.',
    'The retained candidate safety pool is re-probed before publication; long crawl durations can still introduce temporal drift.',
    ...ranking.coverage.notes,
  ];

  await writeOutputs(ranking);
  console.log(
    `[${config.code}] published ${ranking.repositories.length} repositories after complete geography-term crawl.`,
  );
}

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

function canFinalize() {
  const enoughRequests = requestBudget - requestsUsed >= 40;
  const enoughRateLimit =
    !Number.isFinite(minimumRateLimitRemaining) ||
    minimumRateLimitRemaining >= rateLimitReserve;
  return enoughRequests && enoughRateLimit && !runtimeExpired(8 * 60 * 1000);
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
