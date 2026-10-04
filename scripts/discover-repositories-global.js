import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../src/config.js';
import { getCountry } from '../src/countries.js';
import { GitHubGraphQLClient } from '../src/github.js';
import { loadGlobalLocationResolver } from '../src/global-location-resolver.js';
import {
  buildStarRangeQuery,
  candidateThreshold,
  compareRepositories,
  mergeRepositoryCandidate,
  splitStarRange,
} from '../src/repository-search.js';
import { renderMarkdown, writeRankingsIndex } from '../src/output.js';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN or GH_TOKEN is required.');

const requestBudget = clampInt(process.env.REPOSITORY_SCAN_REQUEST_LIMIT, 300, 20, 500);
const rateLimitReserve = clampInt(process.env.RATE_LIMIT_RESERVE, 120, 50, 400);
const runtimeBudgetMs =
  clampInt(process.env.REPOSITORY_SCAN_RUNTIME_MINUTES, 42, 5, 48) * 60 * 1000;
const candidateLimit = clampInt(process.env.REPOSITORY_CANDIDATE_LIMIT, 125, 100, 250);
const pageSize = 100;
const rankingLimit = 100;
const startedAt = Date.now();

const root = projectRoot();
const stateDir = path.join(root, 'state');
const candidateDir = path.join(stateDir, 'repository-candidates');
const statePath = path.join(stateDir, 'repository-first.json');
const dataDir = path.join(root, 'data');
const rankingDir = path.join(root, 'rankings');

await Promise.all([
  mkdir(candidateDir, { recursive: true }),
  mkdir(dataDir, { recursive: true }),
  mkdir(rankingDir, { recursive: true }),
]);

const client = new GitHubGraphQLClient({ token, requestDelayMs: 150 });
const resolver = await loadGlobalLocationResolver();
let state = await readJson(statePath, null);

if (!state || state.schemaVersion !== 1) {
  state = {
    schemaVersion: 1,
    initialized: false,
    queue: [],
    unresolvedStarCounts: [],
    stats: {
      requests: 0,
      repositoriesSeen: 0,
      attributedRepositories: 0,
      ambiguousLocations: 0,
      unknownLocations: 0,
      splitRanges: 0,
      completedLeafRanges: 0,
    },
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRun: null,
  };
}

let requestsUsed = 0;
let minimumRateLimitRemaining = null;
const candidateCache = new Map();
const changedCodes = new Set();
const finalizedCodes = new Set();

if (!state.initialized) {
  const bootstrap = await client.searchRepositoriesPage({
    searchQuery: 'stars:>=1 fork:false sort:stars-desc',
    first: 1,
  });
  requestsUsed += 1;
  state.stats.requests += 1;
  trackRateLimit(bootstrap.rateLimit);

  const topStars = bootstrap.nodes?.[0]?.stargazerCount || 0;
  if (topStars < 1) throw new Error('Repository search bootstrap returned no starred repositories.');

  state.queue = [{
    minStars: 1,
    maxStars: topStars,
    cursor: null,
    pageNumber: 1,
  }];
  state.initialized = true;
  state.topObservedStars = topStars;
  state.updatedAt = new Date().toISOString();
  await writeJson(statePath, state);
  console.log(`Repository-first scan initialized at ${topStars.toLocaleString('en-US')} stars.`);
}

while (
  state.queue.length > 0 &&
  requestsUsed < requestBudget &&
  !runtimeExpired()
) {
  const work = state.queue.shift();
  const query = buildStarRangeQuery(work.minStars, work.maxStars);

  const page = await client.searchRepositoriesPage({
    searchQuery: query,
    first: pageSize,
    cursor: work.cursor || null,
  });

  requestsUsed += 1;
  state.stats.requests += 1;
  trackRateLimit(page.rateLimit);

  if (!work.cursor && Number(page.repositoryCount || 0) > 1000) {
    const children = splitStarRange(work);

    if (children.length === 0) {
      if (!state.unresolvedStarCounts.includes(work.minStars)) {
        state.unresolvedStarCounts.push(work.minStars);
        state.unresolvedStarCounts.sort((a, b) => b - a);
      }
      console.warn(
        `Exact ${work.minStars}-star bucket still exceeds GitHub's search window; blocking finalization below this star count until a deeper shard is implemented.`,
      );
    } else {
      state.queue = [...children, ...state.queue];
      state.stats.splitRanges += 1;
      console.log(
        `Split ${work.minStars}..${work.maxStars} (${page.repositoryCount.toLocaleString('en-US')} repos) into higher/lower star ranges.`,
      );
    }

    await checkpoint();
    if (shouldStopForRateLimit()) break;
    continue;
  }

  for (const node of page.nodes || []) {
    if (!node || node.__typename !== 'Repository' || node.isFork) continue;
    state.stats.repositoriesSeen += 1;

    const attribution = resolver.resolve(node.owner?.location);
    if (!attribution.accepted) {
      if (attribution.confidence === 'ambiguous') state.stats.ambiguousLocations += 1;
      else state.stats.unknownLocations += 1;
      continue;
    }

    const country = getCountry(attribution.countryCode);
    if (!country) continue;

    state.stats.attributedRepositories += 1;
    const candidateState = await getCandidateState(country);
    const repository = toRepositoryRecord(node, attribution);
    candidateState.repositories = mergeRepositoryCandidate(
      candidateState.repositories,
      repository,
      candidateLimit,
    );
    candidateState.updatedAt = new Date().toISOString();
    changedCodes.add(country.code);
  }

  if (page.pageInfo?.hasNextPage && page.pageInfo.endCursor) {
    state.queue.unshift({
      ...work,
      cursor: page.pageInfo.endCursor,
      pageNumber: Number(work.pageNumber || 1) + 1,
    });
  } else {
    state.stats.completedLeafRanges += 1;
  }

  state.updatedAt = new Date().toISOString();
  await checkpoint();

  if (shouldStopForRateLimit()) break;
}

const frontier = currentStarFrontier(state);
const candidateFiles = await listCandidateCodes();

for (const code of candidateFiles) {
  const country = getCountry(code);
  if (!country) continue;
  const candidateState = await getCandidateState(country);
  candidateState.scanFrontierStars = frontier;
  candidateState.updatedAt = new Date().toISOString();

  const threshold = candidateThreshold(candidateState.repositories, rankingLimit);
  const certified = threshold != null && threshold > frontier;

  if (certified && !candidateState.certifiedAt) {
    candidateState.certifiedAt = new Date().toISOString();
    const ranking = buildCertifiedRanking(country, candidateState, state, frontier);
    await Promise.all([
      writeJson(path.join(dataDir, `${country.code}.json`), ranking),
      writeFile(
        path.join(rankingDir, `${country.slug}.md`),
        renderMarkdown(ranking),
        'utf8',
      ),
    ]);
    finalizedCodes.add(code);
    console.log(
      `[${code}] certified top ${rankingLimit}: cutoff=${threshold.toLocaleString('en-US')} stars, remaining global frontier=${frontier.toLocaleString('en-US')}.`,
    );
  }

  if (changedCodes.has(code) || finalizedCodes.has(code)) {
    await writeJson(path.join(candidateDir, `${code}.json`), candidateState);
  }
}

state.updatedAt = new Date().toISOString();
state.lastRun = {
  requestsUsed,
  requestBudget,
  minimumRateLimitRemaining,
  starFrontier: frontier,
  changedCountries: [...changedCodes].sort(),
  finalizedCountries: [...finalizedCodes].sort(),
  runtimeSeconds: Math.round((Date.now() - startedAt) / 1000),
};
await writeJson(statePath, state);
await writeRankingsIndex();

console.log(
  `Repository-first scan finished: requests=${requestsUsed}/${requestBudget}, frontier=${frontier.toLocaleString('en-US')} stars, changed=${changedCodes.size}, finalized=${finalizedCodes.size}.`,
);

async function getCandidateState(country) {
  if (candidateCache.has(country.code)) return candidateCache.get(country.code);

  const filePath = path.join(candidateDir, `${country.code}.json`);
  const existing = await readJson(filePath, null);
  const value = existing || {
    schemaVersion: 1,
    country: {
      code: country.code,
      name: country.name,
      slug: country.slug,
    },
    source: 'repository-first-stars-desc',
    repositories: [],
    scanFrontierStars: null,
    certifiedAt: null,
    updatedAt: new Date().toISOString(),
  };

  candidateCache.set(country.code, value);
  return value;
}

async function listCandidateCodes() {
  const codes = new Set(candidateCache.keys());

  try {
    for (const entry of await readdir(candidateDir, { withFileTypes: true })) {
      const match = entry.isFile() && entry.name.match(/^([A-Z]{2})\.json$/);
      if (match) codes.add(match[1]);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  return [...codes].sort();
}

function buildCertifiedRanking(country, candidateState, scanState, frontier) {
  const repositories = [...candidateState.repositories]
    .sort(compareRepositories)
    .slice(0, rankingLimit)
    .map((repository, index) => ({
      rank: index + 1,
      ...repository,
    }));

  const uniqueOwners = new Set(repositories.map((repo) => repo.owner.login)).size;
  const threshold = repositories.at(-1)?.stars || 0;

  return {
    schemaVersion: 1,
    methodologyVersion: '0.7.0-repository-first',
    generatedAt: new Date().toISOString(),
    country: {
      code: country.code,
      name: country.name,
      slug: country.slug,
    },
    source: {
      provider: 'GitHub GraphQL API',
      endpoint: 'https://api.github.com/graphql',
      countryBasis: 'public repository-owner profile location',
      discovery: 'global repositories scanned by stars descending',
    },
    coverage: {
      status: 'repository-first-certified-by-star-frontier',
      exhaustive: false,
      rawOwnerHits: scanState.stats.repositoriesSeen,
      acceptedUniqueOwners: uniqueOwners,
      ownerMetricLabel: 'Unique owners in top ranking',
      repositoriesConsidered: candidateState.repositories.length,
      publishedRepositories: repositories.length,
      candidateThresholdStars: threshold,
      rankingLimit,
      cappedQueries: [],
      repositoryFirst: {
        scanFrontierStars: frontier,
        topObservedStars: scanState.topObservedStars,
        repositoriesSeen: scanState.stats.repositoriesSeen,
        attributedRepositories: scanState.stats.attributedRepositories,
        ambiguousLocations: scanState.stats.ambiguousLocations,
        unknownLocations: scanState.stats.unknownLocations,
        unresolvedStarCounts: scanState.unresolvedStarCounts,
      },
      notes: [
        'Repositories are scanned globally in descending star ranges, independently of owner follower count or owner-search ordering.',
        'A country is certified only after its 100th repository has more stars than every unprocessed global star range.',
        'Owner country is inferred from the owner public GitHub profile location using the global geography resolver.',
        'Owners with missing or unresolved locations are excluded, so country attribution is not a citizenship or legal-incorporation claim.',
        'Compound city/admin locations such as "Portland, OR" are resolved before ambiguous city-only names.',
      ],
    },
    repositories,
  };
}

function toRepositoryRecord(node, attribution) {
  return {
    name: node.name,
    nameWithOwner: node.nameWithOwner,
    url: node.url,
    description: node.description || null,
    stars: node.stargazerCount || 0,
    forks: node.forkCount || 0,
    primaryLanguage: node.primaryLanguage?.name || null,
    license: node.licenseInfo
      ? {
          name: node.licenseInfo.name || null,
          spdxId: node.licenseInfo.spdxId || null,
        }
      : null,
    createdAt: node.createdAt,
    pushedAt: node.pushedAt,
    homepageUrl: node.homepageUrl || null,
    archived: Boolean(node.isArchived),
    owner: {
      login: node.owner.login,
      name: node.owner.name || null,
      type: node.owner.__typename,
      url: node.owner.url,
      avatarUrl: node.owner.avatarUrl,
      location: node.owner.location || null,
      attribution,
      discoveryTerms: [],
    },
  };
}

function currentStarFrontier(value) {
  const queued = value.queue?.[0]?.maxStars || 0;
  const unresolved = Math.max(0, ...(value.unresolvedStarCounts || []));
  return Math.max(queued, unresolved);
}

function trackRateLimit(rateLimit) {
  const remaining = rateLimit?.remaining;
  if (!Number.isFinite(remaining)) return;
  minimumRateLimitRemaining =
    minimumRateLimitRemaining == null
      ? remaining
      : Math.min(minimumRateLimitRemaining, remaining);
}

function shouldStopForRateLimit() {
  return (
    Number.isFinite(minimumRateLimitRemaining) &&
    minimumRateLimitRemaining < rateLimitReserve
  );
}

function runtimeExpired() {
  return Date.now() - startedAt >= runtimeBudgetMs;
}

async function checkpoint() {
  state.updatedAt = new Date().toISOString();
  await writeJson(statePath, state);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function clampInt(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}
