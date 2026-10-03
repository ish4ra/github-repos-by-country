import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COUNTRY_FILES = new Map([
  ['LK', 'sri-lanka.json'],
]);

export async function loadCountryConfig(code) {
  const normalized = String(code || '').trim().toUpperCase();
  const filename = COUNTRY_FILES.get(normalized);

  if (!filename) {
    throw new Error(`Unsupported country code: ${normalized || '(empty)'}`);
  }

  const configPath = path.join(ROOT, 'config', 'countries', filename);
  const raw = await readFile(configPath, 'utf8');
  const config = JSON.parse(raw);

  validateCountryConfig(config);
  return config;
}

function validateCountryConfig(config) {
  const requiredStrings = ['code', 'name', 'slug', 'methodologyVersion'];
  for (const key of requiredStrings) {
    if (!config[key] || typeof config[key] !== 'string') {
      throw new Error(`Invalid country config: ${key} must be a non-empty string`);
    }
  }

  const requiredArrays = ['countryAliases', 'exactCountryAliases', 'locationTerms', 'searchTerms'];
  for (const key of requiredArrays) {
    if (!Array.isArray(config[key]) || config[key].length === 0) {
      throw new Error(`Invalid country config: ${key} must be a non-empty array`);
    }
  }

  for (const key of ['rankingLimit', 'candidateRepositoriesPerOwner', 'resultsPerPage', 'maxPagesPerQuery']) {
    if (!Number.isInteger(config[key]) || config[key] < 1) {
      throw new Error(`Invalid country config: ${key} must be a positive integer`);
    }
  }

  if (config.resultsPerPage > 100) {
    throw new Error('Invalid country config: resultsPerPage cannot exceed GitHub GraphQL pagination limit of 100');
  }

  if (config.candidateRepositoriesPerOwner > 100) {
    throw new Error(
      'Invalid country config: candidateRepositoriesPerOwner cannot exceed GitHub GraphQL pagination limit of 100',
    );
  }
}

export function projectRoot() {
  return ROOT;
}
