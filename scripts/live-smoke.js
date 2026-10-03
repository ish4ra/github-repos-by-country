import { loadCountryConfig } from '../src/config.js';
import { GitHubGraphQLClient } from '../src/github.js';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  throw new Error('GITHUB_TOKEN or GH_TOKEN is required for the live GraphQL smoke test.');
}

await loadCountryConfig('LK');
const client = new GitHubGraphQLClient({ token, requestDelayMs: 0 });
const discovery = await client.discoverOwnersPage({
  searchQuery: 'location:"Sri Lanka" type:user followers:0..9 repos:>=1 created:2020-01-01..2026-12-31',
  first: 5,
  includeTopRepository: true,
});

if (!Number.isInteger(discovery.userCount) || !discovery.pageInfo || !discovery.rateLimit) {
  throw new Error('GitHub GraphQL discovery smoke test returned an unexpected response shape.');
}

if (!(discovery.nodes || []).every((node) => node?.repositories && Array.isArray(node.repositories.nodes))) {
  throw new Error('GitHub GraphQL inline top-repository discovery returned an unexpected response shape.');
}

const ownerIds = (discovery.nodes || []).map((node) => node?.id).filter(Boolean);
if (ownerIds.length === 0) {
  throw new Error('GitHub GraphQL discovery smoke test returned no owner IDs.');
}

const probe = await client.fetchOwnerRepositories({
  ownerIds,
  reposPerOwner: 1,
});

if (!Array.isArray(probe.nodes) || !probe.rateLimit) {
  throw new Error('GitHub GraphQL repository probe smoke test returned an unexpected response shape.');
}

const deeper = await client.fetchOwnerRepositories({
  ownerIds: ownerIds.slice(0, Math.min(2, ownerIds.length)),
  reposPerOwner: 5,
});

if (!Array.isArray(deeper.nodes) || !deeper.rateLimit) {
  throw new Error('GitHub GraphQL candidate expansion smoke test returned an unexpected response shape.');
}

console.log(
  `Live GraphQL smoke test passed: reported users=${discovery.userCount}, sampled owners=${ownerIds.length}, rate-limit remaining=${deeper.rateLimit.remaining}.`,
);
