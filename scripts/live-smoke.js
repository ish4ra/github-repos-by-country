import { loadCountryConfig } from '../src/config.js';
import { GitHubGraphQLClient } from '../src/github.js';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  throw new Error('GITHUB_TOKEN or GH_TOKEN is required for the live GraphQL smoke test.');
}

const config = await loadCountryConfig('LK');
const client = new GitHubGraphQLClient({ token, requestDelayMs: 0 });
const page = await client.discoverOwnersPage({
  searchTerm: 'Sri Lanka',
  first: 1,
  reposPerOwner: 1,
});

if (!Number.isInteger(page.userCount) || !page.pageInfo || !page.rateLimit) {
  throw new Error('GitHub GraphQL smoke test returned an unexpected response shape.');
}

console.log(
  `Live GraphQL smoke test passed: reported users=${page.userCount}, rate-limit remaining=${page.rateLimit.remaining}.`,
);
