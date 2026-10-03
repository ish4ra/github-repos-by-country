import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { COUNTRIES } from '../src/countries.js';
import { loadCountryConfig, projectRoot } from '../src/config.js';
import { GitHubGraphQLClient } from '../src/github.js';
import { discoverLocationTerm } from '../src/search-shards.js';
import {
  buildRanking,
  createCollector,
  ingestDiscoveryPage,
  recordQueryStats,
  selectCandidateOwners,
} from '../src/ranking.js';
import {
  accumulateDiscoveryStats,
  candidatePoolThreshold,
  createDiscoveryState,
  hydrateCollectorFromCandidates,
  mergeCandidatePools,
  prepareDiscoveryState,
  serializeProbeCandidates,
  DEFAULT_CANDIDATE_POOL_LIMIT,
} from '../src/discovery-state.js';
import { fetchRepositoriesForOwners } from '../src/pipeline.js';
import { writeOutputs } from '../src/output.js';
import { normalizeLocationForComparison } from '../src/location.js';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN or GH_TOKEN is required.');

const termBudget = clampInt(process.env.DISCOVERY_TERM_LIMIT, 200, 1, 500);
const chunkSize = clampInt(process.env.DISCOVERY_CHUNK_SIZE, 20, 1, 50);
const candidatePoolLimit = clampInt(
  process.env.CANDIDATE_POOL_LIMIT,
  DEFAULT_CANDIDATE_POOL_LIMIT,
  100,
  1000,
);

const root = projectRoot();
const stateDir = path.join(root, 'state', 'discovery');
const checkpointPath = path.join(root, 'state', 'global-checkpoint.json');
await mkdir(stateDir, { recursive: true });

const rolloutOrder = [
  'LK',
  ...COUNTRIES.map((country) => country.code).filter((code) => code !== 'LK'),
];

let checkpoint = await readJson(checkpointPath, {
  schemaVersion: 1,
  cycle: 1,
  countryIndex: 0,
  updatedAt: new Date().toISOString(),
});

if (checkpoint.countryIndex >= rolloutOrder.length) {
  checkpoint = {
    ...checkpoint,
    cycle: (checkpoint.cycle || 1) + 1,
    countryIndex: 0,
    updatedAt: new Date().toISOString(),
  };
}

let remainingTerms = termBudget;
let countriesTouched = 0;

while (remainingTerms > 0 && checkpoint.countryIndex < rolloutOrder.length) {
  const code = rolloutOrder[checkpoint.countryIndex];
  const config = await loadCountryConfig(code);

  if (!config.geographySearchTerms.length) {
    console.warn(`[${code}] no generated geography terms; skipping until geography sync is available.`);
    checkpoint.countryIndex += 1;
    continue;
  }

  const terms = buildDiscoveryTerms(config);
  const statePath = path.join(stateDir, `${code}.json`);
  const existing = await readJson(statePath, null);
  let state = prepareDiscoveryState(existing, config, terms, checkpoint.cycle);

  if (!state) state = createDiscoveryState(config, terms, checkpoint.cycle);

  const available = Math.max(0, terms.length - state.nextTermIndex);
  const countryBudget = Math.min(remainingTerms, available);

  if (countryBudget === 0) {
    if (!state.discoveryComplete) {
      state.discoveryComplete = state.unresolvedShards.length === 0;
      state.completedAt = new Date().toISOString();
    }

    if (state.discoveryComplete && !state.finalizedAt) {
      await finalizeCountry(config, state, token);
      state.finalizedAt = new Date().toISOString();
      state.updatedAt = state.finalizedAt;
      await writeJson(statePath, state);
    }

    if (state.discoveryComplete) {
      console.log(`[${code}] discovery complete; advancing rollout.`);
      checkpoint.countryIndex += 1;
      countriesTouched += 1;
      continue;
    }

    console.warn(
      `[${code}] cannot finalize because ${state.unresolvedShards.length} capped shard(s) remain unresolved.`,
    );
    await writeJson(statePath, state);
    break;
  }

  const client = new GitHubGraphQLClient({
    token,
    requestDelayMs: config.requestDelayMs,
  });

  let processedForCountry = 0;

  while (processedForCountry < countryBudget) {
    const size = Math.min(
      chunkSize,
      countryBudget - processedForCountry,
      terms.length - state.nextTermIndex,
    );
    if (size <= 0) break;

    const chunk = terms.slice(state.nextTermIndex, state.nextTermIndex + size);
    const collector = createCollector(config);
    const summaries = [];
    let lowRateLimit = false;

    for (const searchTerm of chunk) {
      console.log(
        `[${code}] term ${state.nextTermIndex + summaries.length + 1}/${terms.length}: ${searchTerm}`,
      );

      const summary = await discoverLocationTerm({
        client,
        searchTerm,
        resultsPerPage: config.resultsPerPage,
        maxPagesPerQuery: config.maxPagesPerQuery,
        onPage: async (page) => {
          ingestDiscoveryPage(collector, {
            searchTerm,
            pageNumber: page.leafPageNumber,
            page,
          });
        },
      });

      summaries.push(summary);
      recordQueryStats(collector, summary);

      if (
        Number.isFinite(summary.minimumRateLimitRemaining) &&
        summary.minimumRateLimitRemaining < 120
      ) {
        lowRateLimit = true;
        console.warn(
          `[${code}] rate-limit reserve reached (${summary.minimumRateLimitRemaining}); finishing this chunk and saving progress.`,
        );
        break;
      }
    }

    const acceptedOwners = [...collector.owners.values()].filter((owner) => owner.id);
    if (acceptedOwners.length > 0) {
      console.log(
        `[${code}] probing ${acceptedOwners.length} unique owner(s) discovered in this chunk.`,
      );
      await fetchRepositoriesForOwners({
        client,
        collector,
        owners: acceptedOwners,
        reposPerOwner: 1,
        batchSize: 50,
        stage: 'probe',
        countryCode: code,
        log: console,
      });
    }

    const freshCandidates = serializeProbeCandidates(collector);
    state.candidates = mergeCandidatePools(
      state.candidates,
      freshCandidates,
      candidatePoolLimit,
    );

    const processedTerms = summaries.length;
    state.nextTermIndex += processedTerms;
    processedForCountry += processedTerms;
    remainingTerms -= processedTerms;
    accumulateDiscoveryStats(state, collector, summaries);

    state.candidatePoolLimit = candidatePoolLimit;
    state.candidatePoolThresholdStars = candidatePoolThreshold(
      state.candidates,
      candidatePoolLimit,
    );

    await writeJson(statePath, state);

    console.log(
      `[${code}] progress ${state.nextTermIndex}/${terms.length}; candidate pool=${state.candidates.length}; threshold=${state.candidatePoolThresholdStars ?? 'n/a'}.`,
    );

    if (lowRateLimit || processedTerms === 0) {
      remainingTerms = 0;
      break;
    }
  }

  countriesTouched += 1;

  if (state.nextTermIndex >= terms.length) {
    state.discoveryComplete = state.unresolvedShards.length === 0;
    state.completedAt = new Date().toISOString();

    if (state.discoveryComplete) {
      await finalizeCountry(config, state, token);
      state.finalizedAt = new Date().toISOString();
      checkpoint.countryIndex += 1;
    }

    state.updatedAt = new Date().toISOString();
    await writeJson(statePath, state);
  }

  if (!state.discoveryComplete) break;
}

checkpoint.updatedAt = new Date().toISOString();
checkpoint.lastRun = {
  termBudget,
  remainingTerms,
  countriesTouched,
};
await writeJson(checkpointPath, checkpoint);

console.log(
  `Global discovery batch finished: cycle=${checkpoint.cycle}, nextCountryIndex=${checkpoint.countryIndex}, termsUsed=${termBudget - remainingTerms}/${termBudget}.`,
);

async function finalizeCountry(config, state, tokenValue) {
  console.log(
    `[${config.code}] finalizing from safety pool of ${state.candidates.length} owner(s).`,
  );

  const client = new GitHubGraphQLClient({
    token: tokenValue,
    requestDelayMs: config.requestDelayMs,
  });

  const collector = hydrateCollectorFromCandidates(config, state.candidates);
  const poolOwners = [...collector.owners.values()].filter((owner) => owner.id);

  // Refresh each retained owner's best repository at finalization time.
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
  ranking.methodologyVersion = '0.4.0-global-crawl';
  ranking.coverage.status = 'global-geography-crawl';
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
  ranking.coverage.notes = [
    'Country attribution uses the generated global country/city/admin geography index plus explicit country aliases.',
    'Ambiguous city/admin names shared by multiple countries are not accepted as city-only evidence.',
    'Broad GitHub user searches are deterministically sharded when they exceed the accessible search-result window.',
    'The geography crawl processes every configured discovery term across repeated rate-limit-aware batches.',
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

    // Always retain explicit country aliases. Skip globally ambiguous
    // city/admin-only terms because they cannot be safely attributed alone.
    const isExplicitCountry = config.countryAliases.some(
      (alias) => normalizeLocationForComparison(alias) === normalized,
    );
    if (!isExplicitCountry && ambiguous.has(normalized)) continue;

    if (!terms.has(normalized)) terms.set(normalized, raw);
  }

  return [...terms.values()];
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

function clampInt(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}
