#!/usr/bin/env node
import { loadCountryConfig } from './config.js';
import { generateCountryRanking } from './pipeline.js';
import { writeOutputs } from './output.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const countryCode = args.country || 'LK';
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  if (!token) {
    throw new Error('Missing GitHub token. Set GITHUB_TOKEN or GH_TOKEN before generating rankings.');
  }

  const config = await loadCountryConfig(countryCode);
  console.info(`Generating ${config.name} repository ranking...`);
  const ranking = await generateCountryRanking(config, { token });
  const outputs = await writeOutputs(ranking);

  console.info(
    `Generated ${ranking.repositories.length} ranked repositories from ${ranking.coverage.acceptedUniqueOwners} accepted owners.`,
  );
  console.info(`JSON: ${outputs.jsonPath}`);
  console.info(`Markdown: ${outputs.markdownPath}`);

  if (ranking.coverage.cappedQueries.length > 0) {
    console.warn(`Capped search terms: ${ranking.coverage.cappedQueries.join(', ')}`);
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--country') {
      result.country = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
