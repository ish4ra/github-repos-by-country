import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getCountry } from './countries.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COUNTRY_OVERRIDE_FILES = new Map([
  ['LK', 'sri-lanka.json'],
]);

export async function loadCountryConfig(code) {
  const normalized = String(code || '').trim().toUpperCase();
  const country = getCountry(normalized);

  if (!country) {
    throw new Error(`Unsupported country code: ${normalized || '(empty)'}`);
  }

  const base = {
    code: country.code,
    name: country.name,
    slug: country.slug,
    methodologyVersion: '0.2.0-poc',
    rankingLimit: 100,
    candidateRepositoriesPerOwner: 100,
    resultsPerPage: 100,
    maxPagesPerQuery: 10,
    requestDelayMs: 250,
    countryAliases: [country.name],
    exactCountryAliases: [country.code.toLowerCase()],
    locationTerms: [],
    searchTerms: [country.name],
    geographyCoverage: 'country-name-only',
  };

  const filename = COUNTRY_OVERRIDE_FILES.get(normalized);
  let config = base;

  if (filename) {
    const configPath = path.join(ROOT, 'config', 'countries', filename);
    const raw = await readFile(configPath, 'utf8');
    config = { ...base, ...JSON.parse(raw), geographyCoverage: 'curated-poc' };
  }

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

  const requiredArrays = ['countryAliases', 'exactCountryAliases', 'searchTerms'];
  for (const key of requiredArrays) {
    if (!Array.isArray(config[key]) || config[key].length === 0) {
      throw new Error(`Invalid country config: ${key} must be a non-empty array`);
    }
  }

  if (!Array.isArray(config.locationTerms)) {
    throw new Error('Invalid country config: locationTerms must be an array');
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
