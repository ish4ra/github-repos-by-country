import { attributeLocation } from './location.js';

export function createCollector(config) {
  return {
    config,
    owners: new Map(),
    rejectedOwners: new Map(),
    queryStats: [],
    rawOwnerHits: 0,
  };
}

export function ingestDiscoveryPage(collector, { searchTerm, pageNumber, page }) {
  collector.rawOwnerHits += page.nodes?.length || 0;

  const existing = collector.queryStats.find((item) => item.term === searchTerm);
  if (!existing) {
    collector.queryStats.push({
      term: searchTerm,
      searchQuery: page.searchQuery,
      reportedCount: page.userCount || 0,
      pagesFetched: pageNumber,
      capped: false,
    });
  } else {
    existing.pagesFetched = Math.max(existing.pagesFetched, pageNumber);
  }

  for (const node of page.nodes || []) {
    if (!node || !['User', 'Organization'].includes(node.__typename)) continue;

    const attribution = attributeLocation(node.location, collector.config);
    if (!attribution.accepted) {
      collector.rejectedOwners.set(node.login, {
        login: node.login,
        type: node.__typename,
        location: node.location || null,
        reason: attribution.evidence,
      });
      continue;
    }

    const current = collector.owners.get(node.login) || {
      login: node.login,
      name: node.name || null,
      type: node.__typename,
      location: node.location || null,
      url: node.url,
      avatarUrl: node.avatarUrl,
      attribution,
      discoveryTerms: new Set(),
      repositories: new Map(),
    };

    current.discoveryTerms.add(searchTerm);
    current.attribution = strongerAttribution(current.attribution, attribution);

    for (const repo of node.repositories?.nodes || []) {
      if (!repo || repo.isFork) continue;
      current.repositories.set(repo.nameWithOwner, repo);
    }

    collector.owners.set(node.login, current);
    collector.rejectedOwners.delete(node.login);
  }
}

export function markQueryCapped(collector, searchTerm) {
  const stat = collector.queryStats.find((item) => item.term === searchTerm);
  if (stat) stat.capped = true;
}

export function buildRanking(collector, generatedAt = new Date().toISOString()) {
  const repositoryMap = new Map();

  for (const owner of collector.owners.values()) {
    for (const repo of owner.repositories.values()) {
      const candidate = {
        name: repo.name,
        nameWithOwner: repo.nameWithOwner,
        url: repo.url,
        description: repo.description || null,
        stars: repo.stargazerCount || 0,
        forks: repo.forkCount || 0,
        primaryLanguage: repo.primaryLanguage?.name || null,
        license: repo.licenseInfo
          ? {
              name: repo.licenseInfo.name || null,
              spdxId: repo.licenseInfo.spdxId || null,
            }
          : null,
        createdAt: repo.createdAt,
        pushedAt: repo.pushedAt,
        homepageUrl: repo.homepageUrl || null,
        archived: Boolean(repo.isArchived),
        owner: {
          login: owner.login,
          name: owner.name,
          type: owner.type,
          url: owner.url,
          location: owner.location,
          attribution: owner.attribution,
          discoveryTerms: [...owner.discoveryTerms].sort((a, b) => a.localeCompare(b)),
        },
      };

      repositoryMap.set(candidate.nameWithOwner, candidate);
    }
  }

  const allRepositories = [...repositoryMap.values()].sort(compareRepositories);
  const published = allRepositories.slice(0, collector.config.rankingLimit).map((repo, index) => ({
    rank: index + 1,
    ...repo,
  }));

  const cappedQueries = collector.queryStats.filter((item) => item.capped).map((item) => item.term);

  return {
    schemaVersion: 1,
    methodologyVersion: collector.config.methodologyVersion,
    generatedAt,
    country: {
      code: collector.config.code,
      name: collector.config.name,
      slug: collector.config.slug,
    },
    source: {
      provider: 'GitHub GraphQL API',
      endpoint: 'https://api.github.com/graphql',
      countryBasis: 'public owner profile location',
    },
    coverage: {
      status: 'experimental',
      exhaustive: false,
      rawOwnerHits: collector.rawOwnerHits,
      acceptedUniqueOwners: collector.owners.size,
      rejectedUniqueOwners: collector.rejectedOwners.size,
      repositoriesConsidered: allRepositories.length,
      publishedRepositories: published.length,
      repositoriesPerOwner: collector.config.repositoriesPerOwner,
      rankingLimit: collector.config.rankingLimit,
      searchQueries: collector.queryStats,
      cappedQueries,
      notes: [
        'GitHub repositories do not expose a native country field; country is inferred from the public location of the repository owner.',
        'GitHub search can cap accessible results for broad queries, so this proof of concept does not claim exhaustive national coverage.',
        `Only the top ${collector.config.repositoriesPerOwner} non-fork public repositories by stars are collected for each discovered owner.`,
        'Owners with missing or unrecognized public locations are excluded instead of being guessed.',
      ],
    },
    repositories: published,
  };
}

function compareRepositories(a, b) {
  if (b.stars !== a.stars) return b.stars - a.stars;
  if (b.forks !== a.forks) return b.forks - a.forks;
  return a.nameWithOwner.localeCompare(b.nameWithOwner);
}

function strongerAttribution(a, b) {
  const weights = { unknown: 0, medium: 1, high: 2 };
  return (weights[b?.confidence] || 0) > (weights[a?.confidence] || 0) ? b : a;
}
