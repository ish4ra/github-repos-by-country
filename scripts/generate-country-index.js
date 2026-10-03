import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../src/config.js';
import { renderRankingsIndex } from '../src/output.js';

const root = projectRoot();
const dataDir = path.join(root, 'data');
const rankingDir = path.join(root, 'rankings');
await mkdir(rankingDir, { recursive: true });

const summaries = [];
for (const entry of await readdir(dataDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
  try {
    const value = JSON.parse(await readFile(path.join(dataDir, entry.name), 'utf8'));
    if (value?.country?.code && value?.country?.slug) summaries.push(value);
  } catch {
    // Skip unrelated JSON.
  }
}

await writeFile(path.join(rankingDir, 'README.md'), renderRankingsIndex(summaries), 'utf8');
console.log('Generated global rankings index.');
