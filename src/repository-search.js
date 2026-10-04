export const REPOSITORY_CANDIDATE_SCHEMA_VERSION = 2;
export const REPOSITORY_RANKING_METHODOLOGY_VERSION = '0.8.0-repository-first';

export const REPOSITORY_SEARCH_WINDOW = 1000;

export function buildStarRangeQuery(minStars, maxStars) {
  const min = Math.max(1, Math.floor(Number(minStars) || 1));
  const max = Math.max(min, Math.floor(Number(maxStars) || min));
  return `stars:${min}..${max} fork:false sort:stars-desc`;
}

export function splitStarRange(range) {
  const min = Number(range?.minStars);
  const max = Number(range?.maxStars);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max) return [];

  const midpoint = Math.floor((min + max) / 2);
  return [
    { minStars: midpoint + 1, maxStars: max, cursor: null, pageNumber: 1 },
    { minStars: min, maxStars: midpoint, cursor: null, pageNumber: 1 },
  ];
}

export function mergeRepositoryCandidate(existing, repository, limit = 125) {
  const byName = new Map(
    (existing || []).map((item) => [item.nameWithOwner, item]),
  );
  byName.set(repository.nameWithOwner, repository);

  return [...byName.values()]
    .sort(compareRepositories)
    .slice(0, limit);
}

export function compareRepositories(a, b) {
  if ((b.stars || 0) !== (a.stars || 0)) return (b.stars || 0) - (a.stars || 0);
  if ((b.forks || 0) !== (a.forks || 0)) return (b.forks || 0) - (a.forks || 0);
  return String(a.nameWithOwner).localeCompare(String(b.nameWithOwner));
}

export function candidateThreshold(repositories, limit = 100) {
  if (!Array.isArray(repositories) || repositories.length < limit) return null;
  return repositories[limit - 1]?.stars ?? null;
}
