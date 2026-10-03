import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directories = ['src', 'scripts', 'tests'];
const files = [];

for (const directory of directories) {
  await collect(path.join(root, directory), files);
}

let failed = false;
for (const file of files.filter((item) => item.endsWith('.js')).sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

if (failed) process.exitCode = 1;
else console.log(`Syntax check passed for ${files.filter((item) => item.endsWith('.js')).length} files.`);

async function collect(directory, output) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(fullPath, output);
    else output.push(fullPath);
  }
}
