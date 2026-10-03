import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCountryConfig } from '../src/config.js';
import {
  buildRanking,
  createCollector,
  ingestDiscoveryPage,
  ingestRepositoryBatch,
} from '../src/ranking.js';

const config = await loadCountryConfig('LK');

function repo(nameWithOwner, stars, forks = 0) {
  return {
    name: nameWithOwner.split('/')[1],
    nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    description: null,
    stargazerCount: stars,
    forkCount: forks,
    isArchived: false,
    isFork: false,
    createdAt: '2020-01-01T00:00:00Z',
    pushedAt: '2026-01-01T00:00:00Z',
    homepageUrl: null,
    primaryLanguage: { name: 'JavaScript' },
    licenseInfo: { name: 'MIT License', spdxId: 'MIT' },
  };
}

function page(nodes) {
  return {
    userCount: nodes.length,
    nodes,
    pageInfo: { hasNextPage: false, endCursor: null },
    rateLimit: { remaining: 999 },
    searchQuery: 'location:"Sri Lanka"',
  };
}

function owner(overrides = {}) {
  return {
    __typename: 'User',
    id: 'U_dev',
    login: 'dev',
    name: 'Dev',
    location: 'Sri Lanka',
    url: 'https://github.com/dev',
    avatarUrl: 'https://example.test/avatar.png',
    ...overrides,
  };
}

test('ranking deduplicates owners and repositories and sorts by stars', () => {
  const collector = createCollector(config);
  const discovered = owner();

  ingestDiscoveryPage(collector, { searchTerm: 'Sri Lanka', pageNumber: 1, page: page([discovered]) });
  ingestDiscoveryPage(collector, { searchTerm: 'Colombo', pageNumber: 1, page: page([discovered]) });

  ingestRepositoryBatch(collector, [
    {
      __typename: 'User',
      id: 'U_dev',
      login: 'dev',
      repositories: { nodes: [repo('dev/one', 10), repo('dev/two', 50)] },
    },
  ]);

  const ranking = buildRanking(collector, '2026-10-03T00:00:00.000Z');
  assert.equal(ranking.coverage.acceptedUniqueOwners, 1);
  assert.equal(ranking.coverage.repositoryBatchesFetched, 1);
  assert.equal(ranking.coverage.repositoriesConsidered, 2);
  assert.deepEqual(
    ranking.repositories.map((item) => item.nameWithOwner),
    ['dev/two', 'dev/one'],
  );
  assert.deepEqual(ranking.repositories[0].owner.discoveryTerms, ['Colombo', 'Sri Lanka']);
});

test('unrecognized owner location is excluded', () => {
  const collector = createCollector(config);
  ingestDiscoveryPage(collector, {
    searchTerm: 'Sri Lanka',
    pageNumber: 1,
    page: page([
      owner({
        id: 'U_elsewhere',
        login: 'elsewhere',
        name: null,
        location: 'Paris, France',
        url: 'https://github.com/elsewhere',
        avatarUrl: '',
      }),
    ]),
  });

  ingestRepositoryBatch(collector, [
    {
      __typename: 'User',
      id: 'U_elsewhere',
      login: 'elsewhere',
      repositories: { nodes: [repo('elsewhere/project', 1000)] },
    },
  ]);

  const ranking = buildRanking(collector);
  assert.equal(ranking.repositories.length, 0);
  assert.equal(ranking.coverage.rejectedUniqueOwners, 1);
});

test('tie breaking uses forks and then repository name', () => {
  const collector = createCollector(config);
  ingestDiscoveryPage(collector, {
    searchTerm: 'Sri Lanka',
    pageNumber: 1,
    page: page([
      owner({
        __typename: 'Organization',
        id: 'O_org',
        login: 'org',
        name: 'Org',
        location: 'Colombo, Sri Lanka',
        url: 'https://github.com/org',
        avatarUrl: '',
      }),
    ]),
  });

  ingestRepositoryBatch(collector, [
    {
      __typename: 'Organization',
      id: 'O_org',
      login: 'org',
      repositories: {
        nodes: [repo('org/b', 100, 5), repo('org/a', 100, 5), repo('org/c', 100, 10)],
      },
    },
  ]);

  const ranking = buildRanking(collector);
  assert.deepEqual(
    ranking.repositories.map((item) => item.nameWithOwner),
    ['org/c', 'org/a', 'org/b'],
  );
});
