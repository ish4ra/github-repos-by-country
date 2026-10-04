import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubGraphQLClient } from '../src/github.js';

test('GraphQL discovery sends a quoted location query and parses response', async () => {
  let capturedBody;
  const fetchImpl = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        data: {
          search: {
            userCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ __typename: 'User', id: 'U_1', login: 'dev' }],
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
  });

  assert.equal(capturedBody.variables.query, 'location:"Sri Lanka"');
  assert.equal(capturedBody.variables.first, 100);
  assert.equal(result.userCount, 1);
  assert.equal(result.nodes[0].id, 'U_1');
});

test('repository fetch uses owner node IDs separately from discovery', async () => {
  let capturedBody;
  const fetchImpl = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        data: {
          nodes: [
            {
              __typename: 'User',
              id: 'U_1',
              login: 'dev',
              repositories: {
                nodes: [
                  {
                    name: 'project',
                    nameWithOwner: 'dev/project',
                    url: 'https://github.com/dev/project',
                    description: null,
                    stargazerCount: 42,
                    forkCount: 3,
                    isArchived: false,
                    isFork: false,
                    createdAt: '2020-01-01T00:00:00Z',
                    pushedAt: '2026-01-01T00:00:00Z',
                    homepageUrl: null,
                    primaryLanguage: { name: 'JavaScript' },
                    licenseInfo: null,
                  },
                ],
              },
            },
          ],
          rateLimit: { cost: 1, limit: 5000, remaining: 4998, resetAt: '2026-10-03T05:00:00Z' },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const client = new GitHubGraphQLClient({ token: 'test-token', requestDelayMs: 0, fetchImpl });
  const result = await client.fetchOwnerRepositories({
    ownerIds: ['U_1'],
    reposPerOwner: 1,
  });

  assert.deepEqual(capturedBody.variables.ids, ['U_1']);
  assert.equal(capturedBody.variables.reposPerOwner, 1);
  assert.equal(result.nodes[0].repositories.nodes[0].stargazerCount, 42);
});

test('no-data responses are retried', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        data: {
          search: {
            userCount: 0,
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
  const result = await client.discoverOwnersPage({ searchTerm: 'Sri Lanka', first: 1 });
  assert.equal(result.userCount, 0);
  assert.equal(calls, 2);
});


test('GraphQL discovery accepts a prebuilt sharded search query', async () => {
  let capturedBody;
  const fetchImpl = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        data: {
          search: {
            userCount: 0,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
          rateLimit: { cost: 1, limit: 5000, remaining: 4999, resetAt: '2026-10-03T07:00:00Z' },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const client = new GitHubGraphQLClient({ token: 'test-token', requestDelayMs: 0, fetchImpl });
  await client.discoverOwnersPage({
    searchQuery: 'location:"Sri Lanka" type:user followers:0..9',
    first: 100,
  });

  assert.equal(
    capturedBody.variables.query,
    'location:"Sri Lanka" type:user followers:0..9',
  );
});


test('discovery can include each owner\'s most-starred repository for resumable global crawl', async () => {
  let capturedBody;
  const fetchImpl = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        data: {
          search: {
            userCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                __typename: 'User',
                id: 'U_1',
                login: 'dev',
                location: 'Sri Lanka',
                repositories: {
                  nodes: [
                    {
                      name: 'project',
                      nameWithOwner: 'dev/project',
                      url: 'https://github.com/dev/project',
                      description: null,
                      stargazerCount: 100,
                      forkCount: 1,
                      isArchived: false,
                      isFork: false,
                      createdAt: '2020-01-01T00:00:00Z',
                      pushedAt: '2026-01-01T00:00:00Z',
                      homepageUrl: null,
                      primaryLanguage: { name: 'JavaScript' },
                      licenseInfo: null,
                    },
                  ],
                },
              },
            ],
          },
          rateLimit: { cost: 1, limit: 5000, remaining: 4999, resetAt: '2026-10-03T07:00:00Z' },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const client = new GitHubGraphQLClient({ token: 'test-token', requestDelayMs: 0, fetchImpl });
  const result = await client.discoverOwnersPage({
    searchTerm: 'Sri Lanka',
    first: 50,
    includeTopRepository: true,
  });

  assert.equal(capturedBody.variables.includeTopRepository, true);
  assert.equal(result.nodes[0].repositories.nodes[0].stargazerCount, 100);
});


test('repository search returns repository owner location inline', async () => {
  let capturedBody;
  const fetchImpl = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      data: {
        search: {
          repositoryCount: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{
            __typename: 'Repository',
            name: 'linux',
            nameWithOwner: 'torvalds/linux',
            url: 'https://github.com/torvalds/linux',
            description: 'Linux kernel source tree',
            stargazerCount: 250000,
            forkCount: 66000,
            isArchived: false,
            isFork: false,
            createdAt: '2011-09-04T22:48:12Z',
            pushedAt: '2026-10-04T00:00:00Z',
            homepageUrl: '',
            primaryLanguage: { name: 'C' },
            licenseInfo: null,
            owner: {
              __typename: 'User',
              login: 'torvalds',
              name: 'Linus Torvalds',
              location: 'Portland, OR',
              url: 'https://github.com/torvalds',
              avatarUrl: 'https://avatars.githubusercontent.com/u/1024025?v=4',
            },
          }],
        },
        rateLimit: { cost: 1, limit: 5000, remaining: 4999, resetAt: '2026-10-04T04:00:00Z' },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const client = new GitHubGraphQLClient({ token: 'test-token', requestDelayMs: 0, fetchImpl });
  const result = await client.searchRepositoriesPage({
    searchQuery: 'stars:200000..300000 fork:false sort:stars-desc',
    first: 100,
  });

  assert.match(capturedBody.query, /type: REPOSITORY/);
  assert.equal(result.repositoryCount, 1);
  assert.equal(result.nodes[0].owner.location, 'Portland, OR');
});
