const FOLLOWER_BUCKETS = [
  'followers:0',
  'followers:1..4',
  'followers:5..9',
  'followers:10..24',
  'followers:25..49',
  'followers:50..99',
  'followers:100..249',
  'followers:250..499',
  'followers:500..999',
  'followers:1000..2499',
  'followers:2500..4999',
  'followers:5000..9999',
  'followers:10000..24999',
  'followers:25000..49999',
  'followers:>=50000',
];

const REPOSITORY_BUCKETS = [
  'repos:1..4',
  'repos:5..9',
  'repos:10..24',
  'repos:25..49',
  'repos:50..99',
  'repos:100..249',
  'repos:250..499',
  'repos:>=500',
];

export async function discoverLocationTerm({
  client,
  searchTerm,
  resultsPerPage = 100,
  maxPagesPerQuery = 10,
  onPage,
  log = console,
  currentYear = new Date().getUTCFullYear(),
}) {
  const baseQuery = `location:"${escapeSearchValue(searchTerm)}"`;
  const summary = {
    term: searchTerm,
    queriesIssued: 0,
    leafQueries: 0,
    pagesFetched: 0,
    reportedCount: 0,
    sharded: false,
    unresolvedQueries: [],
  };

  await visit({
    query: baseQuery,
    stage: 'base',
    client,
    searchTerm,
    resultsPerPage,
    maxPagesPerQuery,
    onPage,
    log,
    currentYear,
    summary,
  });

  return summary;
}

async function visit(context) {
  const {
    client,
    query,
    stage,
    searchTerm,
    resultsPerPage,
    maxPagesPerQuery,
    onPage,
    log,
    currentYear,
    summary,
  } = context;

  const firstPage = await client.discoverOwnersPage({
    searchQuery: query,
    first: resultsPerPage,
    cursor: null,
  });
  summary.queriesIssued += 1;

  const accessibleLimit = resultsPerPage * maxPagesPerQuery;
  const isCapped = Boolean(firstPage.pageInfo?.hasNextPage) && firstPage.userCount > accessibleLimit;

  if (!isCapped) {
    summary.leafQueries += 1;
    summary.reportedCount += firstPage.userCount || 0;
    await consumeLeaf({
      firstPage,
      query,
      searchTerm,
      client,
      resultsPerPage,
      maxPagesPerQuery,
      onPage,
      summary,
    });
    return;
  }

  const children = createChildQueries(query, stage, currentYear);
  if (children.length === 0) {
    summary.unresolvedQueries.push({
      query,
      reportedCount: firstPage.userCount || 0,
      reason: 'search-cap-after-final-shard',
    });
    log.warn?.(
      `[${searchTerm}] unresolved capped shard: ${query} (${firstPage.userCount} results)`,
    );
    return;
  }

  summary.sharded = true;
  log.info?.(
    `[${searchTerm}] sharding ${firstPage.userCount} results at ${stage} into ${children.length} queries.`,
  );

  for (const child of children) {
    await visit({
      ...context,
      query: child.query,
      stage: child.stage,
    });
  }
}

async function consumeLeaf({
  firstPage,
  query,
  searchTerm,
  client,
  resultsPerPage,
  maxPagesPerQuery,
  onPage,
  summary,
}) {
  let page = firstPage;
  let pageNumber = 1;

  while (true) {
    summary.pagesFetched += 1;
    await onPage?.({
      ...page,
      searchQuery: query,
      leafPageNumber: pageNumber,
      sourceTerm: searchTerm,
    });

    if (!page.pageInfo?.hasNextPage) break;
    if (pageNumber >= maxPagesPerQuery) {
      summary.unresolvedQueries.push({
        query,
        reportedCount: page.userCount || firstPage.userCount || 0,
        reason: 'page-limit',
      });
      break;
    }

    pageNumber += 1;
    page = await client.discoverOwnersPage({
      searchQuery: query,
      first: resultsPerPage,
      cursor: page.pageInfo.endCursor,
    });
  }
}

function createChildQueries(query, stage, currentYear) {
  if (stage === 'base') {
    return [
      { query: `${query} type:user`, stage: 'type' },
      { query: `${query} type:org`, stage: 'type' },
    ];
  }

  if (stage === 'type') {
    return FOLLOWER_BUCKETS.map((qualifier) => ({
      query: `${query} ${qualifier}`,
      stage: 'followers',
    }));
  }

  if (stage === 'followers') {
    // repos:0 is intentionally omitted because an owner with zero public
    // repositories cannot contribute to a public repository ranking.
    return REPOSITORY_BUCKETS.map((qualifier) => ({
      query: `${query} ${qualifier}`,
      stage: 'repos',
    }));
  }

  if (stage === 'repos') {
    const children = [];
    for (let year = 2008; year <= currentYear; year += 1) {
      children.push({
        query: `${query} created:${year}-01-01..${year}-12-31`,
        stage: `year:${year}`,
      });
    }
    return children;
  }

  if (stage.startsWith('year:')) {
    const year = Number(stage.slice(5));
    if (!Number.isInteger(year)) return [];
    return Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return {
        query: `${stripCreatedQualifier(query)} created:${formatDate(year, month, 1)}..${formatDate(year, month, lastDay)}`,
        stage: `month:${year}-${month}`,
      };
    });
  }

  if (stage.startsWith('month:')) {
    const [year, month] = stage.slice(6).split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month)) return [];
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: lastDay }, (_, index) => {
      const day = index + 1;
      const date = formatDate(year, month, day);
      return {
        query: `${stripCreatedQualifier(query)} created:${date}`,
        stage: 'day',
      };
    });
  }

  return [];
}

function stripCreatedQualifier(query) {
  return query.replace(/\s+created:[^\s]+/g, '');
}

function formatDate(year, month, day) {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

function escapeSearchValue(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

export const SEARCH_SHARD_LIMITS = Object.freeze({
  followerBuckets: FOLLOWER_BUCKETS,
  repositoryBuckets: REPOSITORY_BUCKETS,
});
