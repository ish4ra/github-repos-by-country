import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginActiveTerm,
  candidatePoolThreshold,
  createDiscoveryState,
  finishActiveTerm,
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

function config() {
  return {
    code: 'LK',
    name: 'Sri Lanka',
    slug: 'sri-lanka',
    geography: {
      source: { release: 'v1', sha256: 'source-hash' },
      contentSha256: 'content-hash',
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

test('active term preserves resumable shard queue until explicitly finished', () => {
  const state = createDiscoveryState(config(), ['Sri Lanka', 'Kalutara'], 1);
  const active = beginActiveTerm(state, 'Sri Lanka');

  active.queue[0].cursor = 'cursor-1';
  const same = beginActiveTerm(state, 'Sri Lanka');
  assert.equal(same.queue[0].cursor, 'cursor-1');
  assert.equal(state.nextTermIndex, 0);

  finishActiveTerm(state);
  assert.equal(state.nextTermIndex, 1);
  assert.equal(state.activeTerm, null);
  assert.equal(state.stats.termsProcessed, 1);
});

test('same crawl resumes schema-v2 state without resetting shard cursor', () => {
  const base = createDiscoveryState(config(), ['one', 'two'], 1);
  beginActiveTerm(base, 'one');
  base.activeTerm.queue[0].cursor = 'resume-me';

  const resumed = prepareDiscoveryState(base, config(), ['one', 'two'], 1);
  assert.equal(resumed.activeTerm.queue[0].cursor, 'resume-me');
  assert.equal(resumed.nextTermIndex, 0);
});

test('changed geography restarts term cursor while retaining safety candidates', () => {
  const oldConfig = config();
  const existing = createDiscoveryState(oldConfig, ['one', 'two'], 1);
  existing.nextTermIndex = 2;
  existing.candidates = [candidate('a', 50)];

  const changed = {
    ...oldConfig,
    geography: {
      ...oldConfig.geography,
      contentSha256: 'new-content-hash',
    },
  };

  const state = prepareDiscoveryState(existing, changed, ['one', 'two', 'three'], 1);
  assert.equal(state.nextTermIndex, 0);
  assert.equal(state.cycle, 1);
  assert.equal(state.candidates.length, 1);
  assert.equal(state.schemaVersion, 2);
});
