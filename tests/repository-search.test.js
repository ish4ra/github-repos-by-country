import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStarRangeQuery,
  candidateThreshold,
  mergeRepositoryCandidate,
  splitStarRange,
} from '../src/repository-search.js';

test('star range queries are deterministic and non-fork', () => {
  assert.equal(
    buildStarRangeQuery(100, 999),
    'stars:100..999 fork:false sort:stars-desc',
  );
});

test('star ranges split high half first', () => {
  assert.deepEqual(splitStarRange({ minStars: 1, maxStars: 100 }), [
    { minStars: 51, maxStars: 100, cursor: null, pageNumber: 1 },
    { minStars: 1, maxStars: 50, cursor: null, pageNumber: 1 },
  ]);
});

test('candidate merge keeps strongest repositories only', () => {
  let repos = [];
  for (const [name, stars] of [['a/x', 10], ['b/x', 30], ['c/x', 20]]) {
    repos = mergeRepositoryCandidate(repos, { nameWithOwner: name, stars, forks: 0 }, 2);
  }
  assert.deepEqual(repos.map((repo) => repo.nameWithOwner), ['b/x', 'c/x']);
  assert.equal(candidateThreshold(repos, 2), 20);
});
