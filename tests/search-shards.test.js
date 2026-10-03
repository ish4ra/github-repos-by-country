import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocationSearchQuery,
  createSearchWorkItem,
  discoverLocationTerm,
  expandSearchWorkItem,
  isSearchPageCapped,
} from '../src/search-shards.js';

function page({ count, hasNextPage = false, cursor = null, nodes = [] }) {
  return {
    userCount: count,
    pageInfo: { hasNextPage, endCursor: cursor },
    nodes,
    rateLimit: { remaining: 999 },
  };
}

test('small location search is consumed without sharding', async () => {
  const queries = [];
  const pages = [];

  const client = {
    async discoverOwnersPage({ searchQuery, cursor }) {
      queries.push({ searchQuery, cursor });
      if (!cursor) return page({ count: 2, hasNextPage: true, cursor: 'next', nodes: [{ login: 'a' }] });
      return page({ count: 2, nodes: [{ login: 'b' }] });
    },
  };

  const summary = await discoverLocationTerm({
    client,
    searchTerm: 'Kalutara',
    onPage: (value) => pages.push(value),
    maxPagesPerQuery: 10,
  });

  assert.equal(summary.sharded, false);
  assert.equal(summary.queriesIssued, 1);
  assert.equal(summary.pagesFetched, 2);
  assert.equal(pages.length, 2);
  assert.equal(queries[0].searchQuery, 'location:"Kalutara"');
});

test('capped base search first splits user and organization accounts', async () => {
  const queries = [];
  const client = {
    async discoverOwnersPage({ searchQuery }) {
      queries.push(searchQuery);
      if (searchQuery === 'location:"Sri Lanka"') {
        return page({ count: 5000, hasNextPage: true, cursor: 'x' });
      }
      return page({ count: 1, nodes: [] });
    },
  };

  const summary = await discoverLocationTerm({
    client,
    searchTerm: 'Sri Lanka',
    onPage: () => {},
  });

  assert.equal(summary.sharded, true);
  assert.deepEqual(queries, [
    'location:"Sri Lanka"',
    'location:"Sri Lanka" type:user',
    'location:"Sri Lanka" type:org',
  ]);
  assert.equal(summary.unresolvedQueries.length, 0);
});

test('capped user shard expands into follower buckets', async () => {
  const queries = [];
  const client = {
    async discoverOwnersPage({ searchQuery }) {
      queries.push(searchQuery);
      if (searchQuery === 'location:"Colombo"') {
        return page({ count: 5000, hasNextPage: true, cursor: 'x' });
      }
      if (searchQuery === 'location:"Colombo" type:user') {
        return page({ count: 4500, hasNextPage: true, cursor: 'x' });
      }
      return page({ count: 10 });
    },
  };

  const summary = await discoverLocationTerm({
    client,
    searchTerm: 'Colombo',
    onPage: () => {},
  });

  assert.ok(queries.some((query) => query.includes('type:user followers:0')));
  assert.ok(queries.some((query) => query.includes('type:user followers:>=50000')));
  assert.ok(queries.includes('location:"Colombo" type:org'));
  assert.equal(summary.unresolvedQueries.length, 0);
});

test('resumable work item expands without losing source query state', () => {
  const base = createSearchWorkItem('United States');
  assert.equal(base.query, buildLocationSearchQuery('United States'));
  assert.equal(base.stage, 'base');
  assert.equal(base.cursor, null);
  assert.equal(base.pageNumber, 1);

  const children = expandSearchWorkItem(base, 2026);
  assert.deepEqual(
    children.map((item) => item.query),
    [
      'location:"United States" type:user',
      'location:"United States" type:org',
    ],
  );
  assert.ok(children.every((item) => item.cursor === null));
});

test('search cap detection follows GitHub 1000-result window', () => {
  assert.equal(isSearchPageCapped(page({ count: 1000, hasNextPage: true })), false);
  assert.equal(isSearchPageCapped(page({ count: 1001, hasNextPage: true })), true);
});
