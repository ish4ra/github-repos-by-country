import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidatePoolThreshold,
  mergeCandidatePools,
  prepareDiscoveryState,
} from '../src/discovery-state.js';

function candidate(login, stars, terms = []) {
  return {
    id: `U_${login}`,
    login,
    type: 'User',
    attribution: { confidence: 'high' },
    discoveryTerms: terms,
    topRepository: {
      nameWithOwner: `${login}/project`,
      stargazerCount: stars,
    },
  };
}

test('candidate safety pool keeps the top N owners plus ties', () => {
  const merged = mergeCandidatePools(
    [],
    [
      candidate('a', 100),
      candidate('b', 90),
      candidate('c', 80),
      candidate('d', 80),
      candidate('e', 10),
    ],
    3,
  );

  assert.deepEqual(merged.map((item) => item.login), ['a', 'b', 'c', 'd']);
  assert.equal(candidatePoolThreshold(merged, 3), 80);
});

test('candidate merge deduplicates discovery terms and keeps stronger top repository', () => {
  const merged = mergeCandidatePools(
    [candidate('a', 50, ['Colombo'])],
    [candidate('a', 75, ['Sri Lanka'])],
    10,
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].topRepository.stargazerCount, 75);
  assert.deepEqual(merged[0].discoveryTerms, ['Colombo', 'Sri Lanka']);
});

test('new crawl cycle restarts term cursor while retaining safety candidates', () => {
  const config = {
    code: 'LK',
    name: 'Sri Lanka',
    slug: 'sri-lanka',
    geography: { source: { release: 'v1', sha256: 'abc' } },
  };
  const existing = {
    schemaVersion: 1,
    cycle: 1,
    country: { code: 'LK' },
    geography: { release: 'v1', sha256: 'abc', termsTotal: 2 },
    nextTermIndex: 2,
    candidates: [candidate('a', 50)],
  };

  const state = prepareDiscoveryState(existing, config, ['one', 'two'], 2);
  assert.equal(state.nextTermIndex, 0);
  assert.equal(state.cycle, 2);
  assert.equal(state.candidates.length, 1);
});
