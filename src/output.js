import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './config.js';
import { COUNTRIES, countryCodeToFlag } from './countries.js';

export async function writeOutputs(ranking) {
  const root = projectRoot();
  const dataDir = path.join(root, 'data');
  const rankingDir = path.join(root, 'rankings');
  await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(rankingDir, { recursive: true })]);

  const jsonPath = path.join(dataDir, `${ranking.country.code}.json`);
  const markdownPath = path.join(rankingDir, `${ranking.country.slug}.md`);

  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(ranking, null, 2)}\n`, 'utf8'),
    writeFile(markdownPath, renderMarkdown(ranking), 'utf8'),
  ]);

  const indexPath = await writeRankingsIndex();
  return { jsonPath, markdownPath, indexPath };
}

export async function writeRankingsIndex() {
  const root = projectRoot();
  const dataDir = path.join(root, 'data');
  const stateDir = path.join(root, 'state', 'discovery');
  const rankingDir = path.join(root, 'rankings');
  await mkdir(rankingDir, { recursive: true });

  const [summaries, progress] = await Promise.all([
    readRankingSummaries(dataDir),
    readDiscoveryStates(stateDir),
  ]);

  const summaryByCode = new Map(summaries.map((summary) => [summary.country.code, summary]));
  const progressByCode = new Map(
    progress
      .filter((state) => state?.country?.code)
      .map((state) => [state.country.code, state]),
  );

  await Promise.all(
    COUNTRIES
      .filter((country) => !summaryByCode.has(country.code))
      .map((country) =>
        writeFile(
          path.join(rankingDir, `${country.slug}.md`),
          renderCountryProgressPage(country, progressByCode.get(country.code)),
          'utf8',
        ),
      ),
  );

  const indexPath = path.join(rankingDir, 'README.md');
  await writeFile(
    indexPath,
    renderRankingsIndex(summaries, COUNTRIES, progress),
    'utf8',
  );
  return indexPath;
}

export function renderMarkdown(ranking) {
  const flag = countryCodeToFlag(ranking.country.code);
  const ownerMetricLabel = ranking.coverage.ownerMetricLabel || 'Accepted owners';
  const lines = [
    `<p align="center" aria-label="${escapeHtml(ranking.country.name)} flag" style="font-size:72px">${flag}</p>`,
    '',
    `<h1 align="center">Most Starred GitHub Repositories in ${escapeHtml(ranking.country.name)}</h1>`,
    '',
    '<p align="center">',
    '  <a href="./README.md"><strong>Browse countries</strong></a> ·',
    `  <a href="../data/${encodeURIComponent(ranking.country.code)}.json">JSON data</a> ·`,
    '  <a href="../docs/METHODOLOGY.md">Methodology</a> ·',
    '  <a href="../README.md">Project home</a>',
    '</p>',
    '',
    '> **Experimental ranking.** Country attribution is inferred from the repository owner’s public GitHub profile location. Coverage limits are shown below instead of being hidden.',
    '',
    `| Updated | Ranked repositories | ${escapeMarkdown(ownerMetricLabel)} | Candidate cutoff | Methodology |`,
    '| --- | ---: | ---: | ---: | --- |',
    `| ${escapeHtml(formatDate(ranking.generatedAt))} | **${formatNumber(ranking.coverage.publishedRepositories)}** | **${formatNumber(ranking.coverage.acceptedUniqueOwners)}** | **${formatNumber(ranking.coverage.candidateThresholdStars || 0)} stars** | \`${escapeHtml(ranking.methodologyVersion)}\` |`,
    '',
    '## Ranking',
    '',
    '<table>',
    '  <thead>',
    '    <tr><th align="right">#</th><th>Repository</th><th align="right">Stars</th><th align="right">Forks</th><th>Language</th><th>Owner location</th></tr>',
    '  </thead>',
    '  <tbody>',
  ];

  for (const repo of ranking.repositories) {
    const avatarUrl = `https://github.com/${encodeURIComponent(repo.owner.login)}.png?size=64`;
    const ownerUrl = repo.owner.url || `https://github.com/${encodeURIComponent(repo.owner.login)}`;
    const description = truncate(repo.description, 150);

    lines.push(
      '    <tr>',
      `      <td align="right"><strong>${repo.rank}</strong></td>`,
      '      <td>',
      `        <a href="${escapeHtml(ownerUrl)}"><img src="${escapeHtml(avatarUrl)}" width="28" height="28" alt="${escapeHtml(repo.owner.login)}" align="left"></a>`,
      `        <a href="${escapeHtml(repo.url)}"><strong>${escapeHtml(repo.nameWithOwner)}</strong></a>${repo.archived ? ' <sub>archived</sub>' : ''}<br>`,
      `        <sub>${description ? escapeHtml(description) : `by ${escapeHtml(repo.owner.login)}`}</sub>`,
      '      </td>',
      `      <td align="right"><strong>${formatNumber(repo.stars)}</strong></td>`,
      `      <td align="right">${formatNumber(repo.forks)}</td>`,
      `      <td>${escapeHtml(repo.primaryLanguage || '—')}</td>`,
      `      <td>${escapeHtml(repo.owner.location || '—')}</td>`,
      '    </tr>',
    );
  }

  lines.push(
    '  </tbody>',
    '</table>',
    '',
    '## Coverage',
    '',
    `- **${formatNumber(ranking.coverage.rawOwnerHits)}** raw owner hits were seen across configured location searches.`,
    `- **${formatNumber(ranking.coverage.acceptedUniqueOwners)}** ${ownerMetricLabel.toLowerCase()} are represented by this published ranking run.`,
    `- **${formatNumber(ranking.coverage.repositoriesConsidered)}** repositories were considered after probe and candidate expansion.`,
    `- Capped search terms: ${ranking.coverage.cappedQueries?.length ? ranking.coverage.cappedQueries.map((item) => '`' + item + '`').join(', ') : 'none'}.`,
    '',
    '<details>',
    '<summary><strong>Known limitations</strong></summary>',
    '',
    ...(ranking.coverage.notes || []).map((note) => `- ${note}`),
    '',
    '</details>',
    '',
    'For the exact attribution and discovery rules, see [`docs/METHODOLOGY.md`](../docs/METHODOLOGY.md).',
    '',
  );

  return lines.join('\n');
}

export function renderRankingsIndex(summaries, countries = COUNTRIES, progressStates = []) {
  const summaryByCode = new Map(summaries.map((summary) => [summary.country.code, summary]));
  const progressByCode = new Map(
    progressStates
      .filter((state) => state?.country?.code)
      .map((state) => [state.country.code, state]),
  );
  const liveCount = summaryByCode.size;
  const buildingCount = [...progressByCode.values()].filter(
    (state) => state.phase && state.phase !== 'complete',
  ).length;

  const lines = [
    '# Browse Repository Rankings',
    '',
    `**${countries.length} countries and territories indexed · ${liveCount} live · ${buildingCount} building**`,
    '',
    'Use your browser\'s **Find** command (`Ctrl+F` / `⌘F`) to jump directly to a country.',
    '',
    '| Country | ISO | Status | Ranking | Repositories | Last updated |',
    '| --- | :---: | :---: | --- | ---: | --- |',
  ];

  for (const country of countries) {
    const summary = summaryByCode.get(country.code);
    const progress = progressByCode.get(country.code);
    const status = renderCountryStatus(summary, progress);
    const rankingCell = summary
      ? `[Most starred repositories](./${summary.country.slug}.md)`
      : `[Open country page](./${country.slug}.md)`;
    const repositoryCount = summary
      ? formatNumber(summary.coverage.publishedRepositories)
      : '—';
    const lastUpdated = progress?.updatedAt || summary?.generatedAt;

    lines.push(
      `| ${country.flag} **${escapeMarkdown(country.name)}** | \`${country.code}\` | ${status} | ${rankingCell} | ${repositoryCount} | ${lastUpdated ? escapeMarkdown(formatDate(lastUpdated)) : '—'} |`,
    );
  }

  lines.push(
    '',
    '## Coverage policy',
    '',
    '- The catalog includes all 249 ISO 3166-1 country/territory codes plus Kosovo (`XK`).',
    '- **Building** means the resumable geography/shard crawl is accumulating verified owner candidates; it is not presented as a finished ranking.',
    '- Global geography combines a pinned Countries States Cities Database release with GeoNames city enrichment.',
    '- Search caps, unresolved shards, ambiguous locations, and temporal drift are surfaced instead of silently producing a supposedly complete ranking.',
    '',
    'See [`docs/ROADMAP.md`](../docs/ROADMAP.md) for the global rollout and users-by-country plan.',
    '',
  );

  return lines.join('\n');
}

export function renderCountryProgressPage(country, progress) {
  const total = Number(progress?.geography?.termsTotal || 0);
  const done = Number(progress?.nextTermIndex || 0);
  const percent = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  const candidateCount = Array.isArray(progress?.candidates) ? progress.candidates.length : 0;
  const phase = progress?.phase === 'finalize'
    ? 'Finalizing'
    : progress
      ? `Building ${percent}%`
      : 'Queued';

  const lines = [
    `<p align="center" aria-label="${escapeHtml(country.name)} flag" style="font-size:72px">${country.flag}</p>`,
    '',
    `<h1 align="center">${escapeHtml(country.name)}</h1>`,
    '',
    '<p align="center">',
    '  <a href="./README.md"><strong>Browse countries</strong></a> ·',
    '  <a href="../docs/METHODOLOGY.md">Methodology</a> ·',
    '  <a href="../README.md">Project home</a>',
    '</p>',
    '',
    `## Repository ranking status: ${phase}`,
    '',
  ];

  if (!progress) {
    lines.push(
      'This country is indexed and queued for the global repository crawl.',
      '',
      'The ranking is not published yet because this project does not label incomplete discovery as a finished country ranking.',
      '',
    );
  } else {
    lines.push(
      `- Geography terms processed: **${formatNumber(done)} / ${formatNumber(total)}**`,
      `- Progress: **${percent}%**`,
      `- Retained high-potential owner candidates: **${formatNumber(candidateCount)}**`,
      `- Search requests completed: **${formatNumber(progress.stats?.searchRequests || 0)}**`,
      `- Unresolved shards: **${formatNumber(progress.unresolvedShards?.length || 0)}**`,
      '',
      'The crawler saves its exact shard queue and pagination cursor, so progress continues across GitHub Actions runs instead of restarting.',
      '',
    );

    const preview = [...(progress.candidates || [])]
      .filter((candidate) => candidate?.topRepository)
      .sort(
        (a, b) =>
          (b.topRepository.stargazerCount || 0) -
            (a.topRepository.stargazerCount || 0) ||
          a.login.localeCompare(b.login),
      )
      .slice(0, 15);

    if (preview.length > 0) {
      lines.push(
        '## Early preview',
        '',
        '> These are the strongest repository candidates discovered **so far**. This is not the final country ranking and can change as city, town, district, alias, and search-shard coverage expands.',
        '',
        '| Repository | Stars | Owner location |',
        '| --- | ---: | --- |',
      );

      for (const candidate of preview) {
        const repository = candidate.topRepository;
        lines.push(
          `| [${escapeMarkdown(repository.nameWithOwner)}](${repository.url}) | **${formatNumber(repository.stargazerCount)}** | ${escapeMarkdown(candidate.location || '—')} |`,
        );
      }

      lines.push('');
    }
  }

  lines.push(
    'When the verified crawl reaches publication readiness, this page is automatically replaced by the most-starred repository ranking.',
    '',
  );

  return lines.join('\n');
}

function renderCountryStatus(summary, progress) {
  if (!progress) return summary ? '**Live**' : 'Queued';
  if (progress.phase === 'complete') return summary ? '**Live**' : 'Completed';

  const total = Number(progress.geography?.termsTotal || 0);
  const done = Number(progress.nextTermIndex || 0);
  const percent = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  const phase = progress.phase === 'finalize' ? 'Finalizing' : `Building ${percent}%`;

  return summary ? `**Live** · ${phase}` : phase;
}

async function readDiscoveryStates(stateDir) {
  let entries;
  try {
    entries = await readdir(stateDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const states = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const content = await readFile(path.join(stateDir, entry.name), 'utf8');
      const parsed = JSON.parse(content);
      if (parsed?.country?.code) states.push(parsed);
    } catch {
      // A damaged progress file must not break the public country index.
    }
  }

  return states;
}

async function readRankingSummaries(dataDir) {
  const entries = await readdir(dataDir, { withFileTypes: true });
  const summaries = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const content = await readFile(path.join(dataDir, entry.name), 'utf8');
      const parsed = JSON.parse(content);
      if (parsed?.country?.code && parsed?.country?.name && parsed?.country?.slug) {
        summaries.push(parsed);
      }
    } catch {
      // Ignore unrelated or temporarily invalid JSON files when rebuilding the index.
    }
  }

  return summaries.sort((a, b) => a.country.name.localeCompare(b.country.name));
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || 'unknown');
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function truncate(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
