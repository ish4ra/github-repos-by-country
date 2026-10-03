import { GitHubGraphQLClient } from './github.js';
import {
  buildRanking,
  createCollector,
  ingestDiscoveryPage,
  ingestRepositoryBatch,
  recordQueryStats,
  selectCandidateOwners,
} from './ranking.js';
import { discoverLocationTerm } from './search-shards.js';

const PROBE_BATCH_SIZE = 50;
const CANDIDATE_BATCH_SIZE = 5;

export async function generateCountryRanking(config, { token, fetchImpl, log = console } = {}) {
  const client = new GitHubGraphQLClient({
    token,
    requestDelayMs: config.requestDelayMs,
    fetchImpl,
  });
  const collector = createCollector(config);

  await discoverOwners(client, collector, config, log);

  const acceptedOwners = [...collector.owners.values()].filter((owner) => owner.id);
  log.info?.(
    `[${config.code}] discovered ${acceptedOwners.length} accepted owners; probing each owner's top repository.`,
  );

  await fetchRepositoriesForOwners({
    client,
    collector,
    owners: acceptedOwners,
    reposPerOwner: 1,
    batchSize: PROBE_BATCH_SIZE,
    stage: 'probe',
    countryCode: config.code,
    log,
  });

  const candidates = selectCandidateOwners(collector, config.rankingLimit);
  log.info?.(
    `[${config.code}] candidate threshold=${collector.candidateThresholdStars ?? 'n/a'} stars; expanding ${candidates.length} owners.`,
  );

  await fetchRepositoriesForOwners({
    client,
    collector,
    owners: candidates,
    reposPerOwner: config.candidateRepositoriesPerOwner,
    batchSize: CANDIDATE_BATCH_SIZE,
    stage: 'candidate',
    countryCode: config.code,
    log,
  });

  return buildRanking(collector);
}

async function discoverOwners(client, collector, config, log) {
  for (const searchTerm of config.searchTerms) {
    log.info?.(`[${config.code}] discover ${searchTerm}`);

    const summary = await discoverLocationTerm({
      client,
      searchTerm,
      resultsPerPage: config.resultsPerPage,
      maxPagesPerQuery: config.maxPagesPerQuery,
      log,
      onPage: async (page) => {
        ingestDiscoveryPage(collector, {
          searchTerm,
          pageNumber: page.leafPageNumber,
          page,
        });
        assertRateLimit(page.rateLimit);
      },
    });

    recordQueryStats(collector, summary);

    if (summary.unresolvedQueries.length > 0) {
      log.warn?.(
        `[${config.code}] ${searchTerm}: ${summary.unresolvedQueries.length} shard(s) remain capped.`,
      );
    }
  }
}

export async function fetchRepositoriesForOwners({
  client,
  collector,
  owners,
  reposPerOwner,
  batchSize,
  stage,
  countryCode,
  log,
}) {
  const batches = chunk(owners, batchSize);

  for (let index = 0; index < batches.length; index += 1) {
    const ownersInBatch = batches[index];
    log.info?.(`[${countryCode}] ${stage}: batch ${index + 1}/${batches.length}`);

    await fetchBatchAdaptive({
      client,
      collector,
      owners: ownersInBatch,
      reposPerOwner,
      stage,
      log,
    });
  }
}

async function fetchBatchAdaptive({ client, collector, owners, reposPerOwner, stage, log }) {
  try {
    const result = await client.fetchOwnerRepositories({
      ownerIds: owners.map((owner) => owner.id),
      reposPerOwner,
    });

    ingestRepositoryBatch(collector, result.nodes, stage);
    assertRateLimit(result.rateLimit);
  } catch (error) {
    if (!isBatchRetryable(error) || owners.length <= 1) {
      throw error;
    }

    const midpoint = Math.ceil(owners.length / 2);
    const left = owners.slice(0, midpoint);
    const right = owners.slice(midpoint);

    log.warn?.(
      `Repository batch failed after retries; splitting ${owners.length} owners into ${left.length} + ${right.length}.`,
    );

    await fetchBatchAdaptive({ client, collector, owners: left, reposPerOwner, stage, log });
    await fetchBatchAdaptive({ client, collector, owners: right, reposPerOwner, stage, log });
  }
}

export function assertRateLimit(rateLimit) {
  if (rateLimit?.remaining != null && rateLimit.remaining < 10) {
    const error = new Error(
      `GitHub GraphQL rate limit is nearly exhausted (${rateLimit.remaining} remaining; reset ${rateLimit.resetAt || 'unknown'}).`,
    );
    error.rateLimit = true;
    throw error;
  }
}

function isBatchRetryable(error) {
  if (error?.rateLimit) return false;
  if (error?.retryable) return true;
  if (error?.status === 429 || error?.status >= 500) return true;
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('no data') ||
    message.includes('something went wrong') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('temporarily unavailable')
  );
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
