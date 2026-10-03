import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './config.js';

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

  return { jsonPath, markdownPath };
}

export function renderMarkdown(ranking) {
  const lines = [
    `# Most Starred GitHub Repositories in ${ranking.country.name}`,
    '',
    '> **Experimental ranking.** Repository country is inferred from the repository owner\'s public GitHub profile location. This proof of concept does not claim exhaustive national coverage.',
    '',
    `Generated: ${ranking.generatedAt}`,
    '',
    `Methodology version: \`${ranking.methodologyVersion}\``,
    '',
    `Accepted owners: **${ranking.coverage.acceptedUniqueOwners.toLocaleString('en-US')}**  `,
    `Repositories considered: **${ranking.coverage.repositoriesConsidered.toLocaleString('en-US')}**  `,
    `Published: **${ranking.coverage.publishedRepositories.toLocaleString('en-US')}**`,
    '',
    '| # | Repository | Stars | Forks | Language | Owner location |',
    '| -: | --- | ---: | ---: | --- | --- |',
  ];

  for (const repo of ranking.repositories) {
    lines.push(
      `| ${repo.rank} | [${escapeMarkdown(repo.nameWithOwner)}](${repo.url})${repo.archived ? ' *(archived)*' : ''} | ${repo.stars.toLocaleString('en-US')} | ${repo.forks.toLocaleString('en-US')} | ${escapeMarkdown(repo.primaryLanguage || '—')} | ${escapeMarkdown(repo.owner.location || '—')} |`,
    );
  }

  lines.push(
    '',
    '## Coverage notes',
    '',
    ...ranking.coverage.notes.map((note) => `- ${note}`),
    '',
    'See [`docs/METHODOLOGY.md`](../docs/METHODOLOGY.md) for the attribution and discovery rules.',
    '',
  );

  return lines.join('\n');
}

function escapeMarkdown(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
