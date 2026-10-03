import { GitHubGraphQLClient } from './github.js';
import { buildRanking, createCollector, ingestDiscoveryPage, markQueryCapped } from './ranking.js';

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
      log.info?.(`[${config.code}] ${searchTerm}: page ${pageNumber}`);

      const page = await client.discoverOwnersPage({
        searchTerm,
        first: config.resultsPerPage,
        cursor,
        reposPerOwner: config.repositoriesPerOwner,
      });

      ingestDiscoveryPage(collector, { searchTerm, pageNumber, page });

      if (page.rateLimit?.remaining != null && page.rateLimit.remaining < 10) {
        throw new Error(
          `GitHub GraphQL rate limit is nearly exhausted (${page.rateLimit.remaining} remaining; reset ${page.rateLimit.resetAt || 'unknown'}).`,
        );
      }

      hasNextPage = Boolean(page.pageInfo?.hasNextPage);
      cursor = page.pageInfo?.endCursor || null;
    }

    if (hasNextPage) {
      markQueryCapped(collector, searchTerm);
      log.warn?.(
        `[${config.code}] ${searchTerm}: stopped after ${config.maxPagesPerQuery} pages; coverage for this term is capped.`,
      );
    }
  }

  return buildRanking(collector);
}
