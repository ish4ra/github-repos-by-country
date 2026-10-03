import { GitHubGraphQLClient } from './github.js';
import {
  buildRanking,
  createCollector,
  ingestDiscoveryPage,
  ingestRepositoryBatch,
  markQueryCapped,
} from './ranking.js';

const OWNER_REPOSITORY_BATCH_SIZE = 25;

export async function generateCountryRanking(config, { token, fetchImpl, log = console } = {}) {
  const client = new GitHubGraphQLClient({
    token,
    requestDelayMs: config.requestDelayMs,
    fetchImpl,
  });
  const collector = createCollector(config);

  for (const searchTerm of config.searchTerms) {
    let cursor = null;
    let pageNumber = 0;
    let hasNextPage = true;

    while (hasNextPage && pageNumber < config.maxPagesPerQuery) {
      pageNumber += 1;
      log.info?.(`[${config.code}] discover ${searchTerm}: page ${pageNumber}`);

      const page = await client.discoverOwnersPage({
        searchTerm,
        first: config.resultsPerPage,
        cursor,
      });

      ingestDiscoveryPage(collector, { searchTerm, pageNumber, page });
      assertRateLimit(page.rateLimit);

      hasNextPage = Boolean(page.pageInfo?.hasNextPage);
      cursor = page.pageInfo?.endCursor || null;
    }

    const queryStat = collector.queryStats.find((item) => item.term === searchTerm);
    const accessibleResultLimit = config.resultsPerPage * config.maxPagesPerQuery;
    const capped = hasNextPage || (queryStat?.reportedCount || 0) > accessibleResultLimit;

    if (capped) {
      markQueryCapped(collector, searchTerm);
      log.warn?.(
        `[${config.code}] ${searchTerm}: search coverage is capped at approximately ${accessibleResultLimit} accessible results.`,
      );
    }
  }

  const acceptedOwners = [...collector.owners.values()].filter((owner) => owner.id);
  const batches = chunk(acceptedOwners, OWNER_REPOSITORY_BATCH_SIZE);

  log.info?.(
    `[${config.code}] discovered ${acceptedOwners.length} accepted owners; fetching repositories in ${batches.length} batches.`,
  );

  for (let index = 0; index < batches.length; index += 1) {
    const owners = batches[index];
    log.info?.(`[${config.code}] repositories: batch ${index + 1}/${batches.length}`);

    const result = await client.fetchOwnerRepositories({
      ownerIds: owners.map((owner) => owner.id),
      reposPerOwner: config.repositoriesPerOwner,
    });

    ingestRepositoryBatch(collector, result.nodes);
    assertRateLimit(result.rateLimit);
  }

  return buildRanking(collector);
}

function assertRateLimit(rateLimit) {
  if (rateLimit?.remaining != null && rateLimit.remaining < 10) {
    throw new Error(
      `GitHub GraphQL rate limit is nearly exhausted (${rateLimit.remaining} remaining; reset ${rateLimit.resetAt || 'unknown'}).`,
    );
  }
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
