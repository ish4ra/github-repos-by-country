import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './config.js';

export async function writeOutputs(ranking) {
  const root = projectRoot();
  const dataDir = path.join(root, 'data');
  const rankingDir = path.join(root, 'rankings');
  await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(rankingDir, { recursive: true })]);

  const jsonPath = path.join(dataDir, `${ranking.country.code}.json`);
  const markdownPath = path.join(rankingDir, `${ranking.country.slug}.md`);
  const indexPath = path.join(rankingDir, 'README.md');

  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(ranking, null, 2)}\n`, 'utf8'),
    writeFile(markdownPath, renderMarkdown(ranking), 'utf8'),
  ]);

  const summaries = await readRankingSummaries(dataDir);
  await writeFile(indexPath, renderRankingsIndex(summaries), 'utf8');

  return { jsonPath, markdownPath, indexPath };
}

export function renderMarkdown(ranking) {
  const flag = countryCodeToFlag(ranking.country.code);
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
    '| Updated | Ranked repositories | Accepted owners | Candidate cutoff | Methodology |',
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
    `- **${formatNumber(ranking.coverage.acceptedUniqueOwners)}** unique owners passed the current location-attribution rules.`,
    `- **${formatNumber(ranking.coverage.repositoriesConsidered)}** repositories were considered after probe and candidate expansion.`,
    `- Capped search terms: ${ranking.coverage.cappedQueries.length ? ranking.coverage.cappedQueries.map((item) => '`' + item + '`').join(', ') : 'none'}.`,
    '',
    '<details>',
    '<summary><strong>Known limitations</strong></summary>',
    '',
    ...ranking.coverage.notes.map((note) => `- ${note}`),
    '',
    '</details>',
    '',
    'For the exact attribution and discovery rules, see [`docs/METHODOLOGY.md`](../docs/METHODOLOGY.md).',
    '',
  );

  return lines.join('\n');
}

export function renderRankingsIndex(summaries) {
  const lines = [
    '# Browse Repository Rankings',
    '',
    'Country pages are generated from GitHub data and linked here for quick browsing.',
    '',
    '> Use your browser\'s **Find** command (`Ctrl+F` / `⌘F`) to jump to a country as the index grows.',
    '',
    '| Country | Ranking | Repositories | Top repository | Last updated |',
    '| --- | --- | ---: | --- | --- |',
  ];

  for (const summary of summaries) {
    const top = summary.repositories?.[0];
    const topCell = top ? `[${escapeMarkdown(top.nameWithOwner)}](${top.url})` : '—';
    lines.push(
      `| ${countryCodeToFlag(summary.country.code)} **${escapeMarkdown(summary.country.name)}** | [Most starred repositories](./${summary.country.slug}.md) | ${formatNumber(summary.coverage.publishedRepositories)} | ${topCell} | ${escapeMarkdown(formatDate(summary.generatedAt))} |`,
    );
  }

  lines.push(
    '',
    '## Data',
    '',
    'Machine-readable country datasets live in [`data/`](../data/).',
    '',
    '## Accuracy',
    '',
    'A country page is only as complete as owner discovery allows. Search caps, free-form GitHub profile locations, and ambiguous locations are reported rather than hidden. The global rollout will replace small hand-maintained city lists with a comprehensive geography catalog covering recognized countries, cities, towns, districts/regions, aliases, and common spelling variants where attribution can be made safely.',
    '',
  );

  return lines.join('\n');
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

function countryCodeToFlag(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[A-Z]/g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
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
