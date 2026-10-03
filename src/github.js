const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

const DISCOVERY_QUERY = `
  query DiscoverOwners($query: String!, $first: Int!, $cursor: String) {
    search(type: USER, query: $query, first: $first, after: $cursor) {
      userCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        __typename
        ... on User {
          id
          login
          name
          location
          url
          avatarUrl
        }
        ... on Organization {
          id
          login
          name
          location
          url
          avatarUrl
        }
      }
    }
    rateLimit {
      cost
      limit
      remaining
      resetAt
    }
  }
`;

const REPOSITORY_BATCH_QUERY = `
  query FetchOwnerRepositories($ids: [ID!]!, $reposPerOwner: Int!) {
    nodes(ids: $ids) {
      __typename
      ... on User {
        id
        login
        repositories(
          first: $reposPerOwner
          ownerAffiliations: OWNER
          privacy: PUBLIC
          isFork: false
          orderBy: { field: STARGAZERS, direction: DESC }
        ) {
          nodes {
            ...RepositoryFields
          }
        }
      }
      ... on Organization {
        id
        login
        repositories(
          first: $reposPerOwner
          ownerAffiliations: OWNER
          privacy: PUBLIC
          isFork: false
          orderBy: { field: STARGAZERS, direction: DESC }
        ) {
          nodes {
            ...RepositoryFields
          }
        }
      }
    }
    rateLimit {
      cost
      limit
      remaining
      resetAt
    }
  }

  fragment RepositoryFields on Repository {
    name
    nameWithOwner
    url
    description
    stargazerCount
    forkCount
    isArchived
    isFork
    createdAt
    pushedAt
    homepageUrl
    primaryLanguage {
      name
    }
    licenseInfo {
      name
      spdxId
    }
  }
`;

export class GitHubGraphQLClient {
  constructor({ token, requestDelayMs = 250, fetchImpl = globalThis.fetch } = {}) {
    if (!token) {
      throw new Error('A GitHub token is required. Set GITHUB_TOKEN or GH_TOKEN.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('A fetch implementation is required. Node.js 22+ provides one globally.');
    }

    this.token = token;
    this.requestDelayMs = requestDelayMs;
    this.fetch = fetchImpl;
  }

  async discoverOwnersPage({ searchTerm, searchQuery, first, cursor = null }) {
    const query = searchQuery || `location:"${escapeSearchValue(searchTerm)}"`;
    if (!query) throw new Error('A user-search query is required.');
    const payload = await this.#request(DISCOVERY_QUERY, {
      query,
      first,
      cursor,
    });

    return {
      ...payload.search,
      rateLimit: payload.rateLimit,
      searchQuery: query,
    };
  }

  async fetchOwnerRepositories({ ownerIds, reposPerOwner }) {
    if (!Array.isArray(ownerIds) || ownerIds.length === 0) {
      return { nodes: [], rateLimit: null };
    }

    const payload = await this.#request(REPOSITORY_BATCH_QUERY, {
      ids: ownerIds,
      reposPerOwner,
    });

    return {
      nodes: payload.nodes || [],
      rateLimit: payload.rateLimit,
    };
  }

  async #request(query, variables) {
    const maxAttempts = 4;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (attempt > 1) {
          await sleep(Math.min(2 ** attempt * 1000, 15000));
        }

        const response = await this.fetch(GRAPHQL_ENDPOINT, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'github-repos-by-country',
          },
          body: JSON.stringify({ query, variables }),
        });

        const retryAfter = Number(response.headers.get('retry-after') || 0);
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          const message = data?.message || `GitHub GraphQL HTTP ${response.status}`;
          const error = new Error(message);
          error.status = response.status;
          error.retryAfter = retryAfter;
          throw error;
        }

        if (Array.isArray(data?.errors) && data.errors.length > 0) {
          const message = data.errors.map((item) => item.message).join('; ');
          const error = new Error(`GitHub GraphQL error: ${message}`);
          error.graphqlErrors = data.errors;
          error.retryAfter = retryAfter;
          if (!data.data) error.retryable = true;
          throw error;
        }

        if (!data?.data) {
          const error = new Error('GitHub GraphQL returned no data');
          error.retryable = true;
          throw error;
        }

        if (this.requestDelayMs > 0) {
          await sleep(this.requestDelayMs);
        }

        return data.data;
      } catch (error) {
        lastError = error;
        const retryable = isRetryable(error);
        if (!retryable || attempt === maxAttempts) break;

        if (Number.isFinite(error.retryAfter) && error.retryAfter > 0) {
          await sleep(Math.min(error.retryAfter * 1000, 60000));
        }
      }
    }

    throw lastError;
  }
}

function escapeSearchValue(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

function isRetryable(error) {
  if (error?.retryable) return true;
  if (error?.status === 429) return true;
  if (error?.status >= 500) return true;
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('temporarily unavailable') ||
    message.includes('something went wrong') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('no data')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
