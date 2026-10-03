import { loadCountryConfig } from '../src/config.js';
import { GitHubGraphQLClient } from '../src/github.js';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  throw new Error('GITHUB_TOKEN or GH_TOKEN is required for the live GraphQL smoke test.');
}

const config = await loadCountryConfig('LK');
const client = new GitHubGraphQLClient({ token, requestDelayMs: 0 });
const discovery = await client.discoverOwnersPage({
  searchTerm: 'Sri Lanka',
  first: 2,
});

if (!Number.isInteger(discovery.userCount) || !discovery.pageInfo || !discovery.rateLimit) {
  throw new Error('GitHub GraphQL discovery smoke test returned an unexpected response shape.');
}

const ownerIds = (discovery.nodes || []).map((node) => node?.id).filter(Boolean);
if (ownerIds.length === 0) {
  throw new Error('GitHub GraphQL discovery smoke test returned no owner IDs.');
}

const repositories = await client.fetchOwnerRepositories({
  ownerIds,
  reposPerOwner: 1,
});

if (!Array.isArray(repositories.nodes) || !repositories.rateLimit) {
  throw new Error('GitHub GraphQL repository smoke test returned an unexpected response shape.');
}

console.log(
  `Live GraphQL smoke test passed: reported users=${discovery.userCount}, sampled owners=${ownerIds.length}, rate-limit remaining=${repositories.rateLimit.remaining}.`,
);
