import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubGraphQLClient } from '../src/github.js';

test('GraphQL client sends a quoted location query and parses response', async () => {
  let capturedBody;
  const fetchImpl = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        data: {
          search: {
            userCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
          rateLimit: { cost: 1, limit: 5000, remaining: 4999, resetAt: '2026-10-03T05:00:00Z' },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const client = new GitHubGraphQLClient({ token: 'test-token', requestDelayMs: 0, fetchImpl });
  const result = await client.discoverOwnersPage({
    searchTerm: 'Sri Lanka',
    first: 100,
    reposPerOwner: 25,
  });

  assert.equal(capturedBody.variables.query, 'location:"Sri Lanka"');
  assert.equal(capturedBody.variables.first, 100);
  assert.equal(capturedBody.variables.reposPerOwner, 25);
  assert.equal(result.userCount, 1);
});
