import { createCollector } from './ranking.js';

export const DEFAULT_CANDIDATE_POOL_LIMIT = 500;

export function createDiscoveryState(config, terms, cycle = 1) {
  return {
    schemaVersion: 1,
    cycle,
    country: {
      code: config.code,
      name: config.name,
      slug: config.slug,
    },
    geography: {
      release: config.geography?.source?.release || null,
      sha256: config.geography?.source?.sha256 || null,
      termsTotal: terms.length,
    },
    nextTermIndex: 0,
    discoveryComplete: false,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    finalizedAt: null,
    stats: emptyStats(),
    unresolvedShards: [],
    candidates: [],
  };
}

export function prepareDiscoveryState(existing, config, terms, cycle = 1) {
  if (!existing || existing.schemaVersion !== 1 || existing.country?.code !== config.code) {
    return createDiscoveryState(config, terms, cycle);
  }

  const sourceChanged =
    existing.geography?.sha256 !== (config.geography?.source?.sha256 || null) ||
    existing.geography?.termsTotal !== terms.length;
  const cycleChanged = existing.cycle !== cycle;

  if (!sourceChanged && !cycleChanged) return existing;

  return {
    ...existing,
    cycle,
    geography: {
      release: config.geography?.source?.release || null,
      sha256: config.geography?.source?.sha256 || null,
      termsTotal: terms.length,
    },
    nextTermIndex: 0,
    discoveryComplete: false,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    finalizedAt: null,
    stats: emptyStats(),
    unresolvedShards: [],
    // Keep the prior candidate safety pool. A fresh crawl will re-probe
    // candidates before publishing and can only improve this pool.
    candidates: existing.candidates || [],
  };
}

export function serializeProbeCandidates(collector) {
  const candidates = [];

  for (const owner of collector.owners.values()) {
    const repositories = [...owner.repositories.values()].sort(
      (a, b) => (b.stargazerCount || 0) - (a.stargazerCount || 0),
    );
    const topRepository = repositories[0];
    if (!topRepository) continue;

    candidates.push({
      id: owner.id,
      login: owner.login,
      name: owner.name || null,
      type: owner.type,
      location: owner.location || null,
      url: owner.url,
      avatarUrl: owner.avatarUrl,
      attribution: owner.attribution,
      discoveryTerms: [...owner.discoveryTerms].sort((a, b) => a.localeCompare(b)),
      topRepository,
    });
  }

  return candidates;
}

export function mergeCandidatePools(
  existing,
  fresh,
  poolLimit = DEFAULT_CANDIDATE_POOL_LIMIT,
) {
  const byLogin = new Map();

  for (const item of [...(existing || []), ...(fresh || [])]) {
    if (!item?.login || !item?.topRepository) continue;

    const current = byLogin.get(item.login);
    if (!current) {
      byLogin.set(item.login, normalizeCandidate(item));
      continue;
    }

    const currentStars = current.topRepository?.stargazerCount || 0;
    const nextStars = item.topRepository?.stargazerCount || 0;
    const stronger = strongerAttribution(current.attribution, item.attribution);

    byLogin.set(item.login, {
      ...current,
      ...item,
      attribution: stronger,
      discoveryTerms: [...new Set([
        ...(current.discoveryTerms || []),
        ...(item.discoveryTerms || []),
      ])].sort((a, b) => a.localeCompare(b)),
      topRepository: nextStars >= currentStars ? item.topRepository : current.topRepository,
    });
  }

  const sorted = [...byLogin.values()].sort(compareCandidateOwners);
  if (sorted.length <= poolLimit) return sorted;

  const threshold = sorted[poolLimit - 1].topRepository.stargazerCount || 0;
  return sorted.filter(
    (item) => (item.topRepository.stargazerCount || 0) >= threshold,
  );
}

export function hydrateCollectorFromCandidates(config, candidates) {
  const collector = createCollector(config);

  for (const item of candidates || []) {
    collector.owners.set(item.login, {
      id: item.id,
      login: item.login,
      name: item.name || null,
      type: item.type,
      location: item.location || null,
      url: item.url,
      avatarUrl: item.avatarUrl,
      attribution: item.attribution,
      discoveryTerms: new Set(item.discoveryTerms || []),
      repositories: new Map(
        item.topRepository
          ? [[item.topRepository.nameWithOwner, item.topRepository]]
          : [],
      ),
    });
  }

  return collector;
}

export function accumulateDiscoveryStats(state, collector, summaries) {
  state.stats.termsProcessed += summaries.length;
  state.stats.rawOwnerHits += collector.rawOwnerHits || 0;
  state.stats.acceptedOwnerHits += collector.owners.size;
  state.stats.rejectedOwnerHits += collector.rejectedOwners.size;

  for (const summary of summaries) {
    state.stats.searchQueries += summary.queriesIssued || 0;
    state.stats.leafQueries += summary.leafQueries || 0;
    state.stats.pagesFetched += summary.pagesFetched || 0;
    state.stats.shardedTerms += summary.sharded ? 1 : 0;

    for (const unresolved of summary.unresolvedQueries || []) {
      state.unresolvedShards.push({
        term: summary.term,
        ...unresolved,
      });
    }
  }

  if (state.unresolvedShards.length > 200) {
    state.unresolvedShards = state.unresolvedShards.slice(-200);
  }

  state.stats.unresolvedShardCount = state.unresolvedShards.length;
  state.updatedAt = new Date().toISOString();
}

export function candidatePoolThreshold(candidates, poolLimit = DEFAULT_CANDIDATE_POOL_LIMIT) {
  if (!Array.isArray(candidates) || candidates.length < poolLimit) return null;
  return candidates[poolLimit - 1]?.topRepository?.stargazerCount ?? null;
}

function normalizeCandidate(item) {
  return {
    ...item,
    discoveryTerms: [...new Set(item.discoveryTerms || [])].sort((a, b) => a.localeCompare(b)),
  };
}

function compareCandidateOwners(a, b) {
  const starDifference =
    (b.topRepository?.stargazerCount || 0) - (a.topRepository?.stargazerCount || 0);
  if (starDifference !== 0) return starDifference;
  return a.login.localeCompare(b.login);
}

function strongerAttribution(a, b) {
  const weights = { unknown: 0, medium: 1, high: 2 };
  return (weights[b?.confidence] || 0) > (weights[a?.confidence] || 0) ? b : a;
}

function emptyStats() {
  return {
    termsProcessed: 0,
    searchQueries: 0,
    leafQueries: 0,
    pagesFetched: 0,
    shardedTerms: 0,
    rawOwnerHits: 0,
    acceptedOwnerHits: 0,
    rejectedOwnerHits: 0,
    unresolvedShardCount: 0,
  };
}
