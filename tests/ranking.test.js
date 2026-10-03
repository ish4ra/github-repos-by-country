import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCountryConfig } from '../src/config.js';
import {
  buildRanking,
  createCollector,
  ingestDiscoveryPage,
  ingestRepositoryBatch,
  selectCandidateOwners,
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

function owner(login = 'dev', overrides = {}) {
  return {
    __typename: 'User',
    id: `U_${login}`,
    login,
    name: login,
    location: 'Sri Lanka',
    url: `https://github.com/${login}`,
    avatarUrl: 'https://example.test/avatar.png',
    ...overrides,
  };
}

test('ranking deduplicates owners and repositories and sorts by stars', () => {
  const collector = createCollector(config);
  const discovered = owner();

  ingestDiscoveryPage(collector, { searchTerm: 'Sri Lanka', pageNumber: 1, page: page([discovered]) });
  ingestDiscoveryPage(collector, { searchTerm: 'Colombo', pageNumber: 1, page: page([discovered]) });

  ingestRepositoryBatch(
    collector,
    [
      {
        __typename: 'User',
        id: 'U_dev',
        login: 'dev',
        repositories: { nodes: [repo('dev/one', 10), repo('dev/two', 50)] },
      },
    ],
    'candidate',
  );

  const ranking = buildRanking(collector, '2026-10-03T00:00:00.000Z');
  assert.equal(ranking.coverage.acceptedUniqueOwners, 1);
  assert.equal(ranking.coverage.candidateBatchesFetched, 1);
  assert.equal(ranking.coverage.repositoriesConsidered, 2);
  assert.deepEqual(
    ranking.repositories.map((item) => item.nameWithOwner),
    ['dev/two', 'dev/one'],
  );
  assert.deepEqual(ranking.repositories[0].owner.discoveryTerms, ['Colombo', 'Sri Lanka']);
});

test('probe threshold safely selects every owner that can affect the top N', () => {
  const collector = createCollector({ ...config, rankingLimit: 3 });
  const owners = [
    owner('a'),
    owner('b'),
    owner('c'),
    owner('d'),
    owner('e'),
  ];

  ingestDiscoveryPage(collector, {
    searchTerm: 'Sri Lanka',
    pageNumber: 1,
    page: page(owners),
  });

  const probeStars = new Map([
    ['a', 100],
    ['b', 80],
    ['c', 60],
    ['d', 59],
    ['e', 1],
  ]);

  ingestRepositoryBatch(
    collector,
    owners.map((item) => ({
      __typename: 'User',
      id: item.id,
      login: item.login,
      repositories: { nodes: [repo(`${item.login}/top`, probeStars.get(item.login))] },
    })),
    'probe',
  );

  const candidates = selectCandidateOwners(collector, 3);
  assert.deepEqual(candidates.map((item) => item.login), ['a', 'b', 'c']);
  assert.equal(collector.candidateThresholdStars, 60);
});

test('probe threshold keeps all owners tied at the cutoff', () => {
  const collector = createCollector({ ...config, rankingLimit: 2 });
  const owners = [owner('a'), owner('b'), owner('c')];

  ingestDiscoveryPage(collector, {
    searchTerm: 'Sri Lanka',
    pageNumber: 1,
    page: page(owners),
  });

  ingestRepositoryBatch(
    collector,
    [
      { __typename: 'User', login: 'a', repositories: { nodes: [repo('a/top', 100)] } },
      { __typename: 'User', login: 'b', repositories: { nodes: [repo('b/top', 50)] } },
      { __typename: 'User', login: 'c', repositories: { nodes: [repo('c/top', 50)] } },
    ],
    'probe',
  );

  const candidates = selectCandidateOwners(collector, 2);
  assert.deepEqual(candidates.map((item) => item.login), ['a', 'b', 'c']);
  assert.equal(collector.candidateThresholdStars, 50);
});

test('unrecognized owner location is excluded', () => {
  const collector = createCollector(config);
  ingestDiscoveryPage(collector, {
    searchTerm: 'Sri Lanka',
    pageNumber: 1,
    page: page([
      owner('elsewhere', {
        location: 'Paris, France',
      }),
    ]),
  });

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
      owner('org', {
        __typename: 'Organization',
        id: 'O_org',
        name: 'Org',
        location: 'Colombo, Sri Lanka',
      }),
    ]),
  });

  ingestRepositoryBatch(
    collector,
    [
      {
        __typename: 'Organization',
        id: 'O_org',
        login: 'org',
        repositories: {
          nodes: [repo('org/b', 100, 5), repo('org/a', 100, 5), repo('org/c', 100, 10)],
        },
      },
    ],
    'candidate',
  );

  const ranking = buildRanking(collector);
  assert.deepEqual(
    ranking.repositories.map((item) => item.nameWithOwner),
    ['org/c', 'org/a', 'org/b'],
  );
});
