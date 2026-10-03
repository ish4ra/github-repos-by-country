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
    methodologyVersion: '0.3.0-global-geography',
    rankingLimit: 100,
    candidateRepositoriesPerOwner: 100,
    resultsPerPage: 100,
    maxPagesPerQuery: 10,
    requestDelayMs: 250,
    countryAliases: [country.name],
    exactCountryAliases: [country.code.toLowerCase()],
    locationTerms: [],
    curatedLocationTerms: [],
    ambiguousLocationTerms: [],
    searchTerms: [country.name],
    geographySearchTerms: [],
    geographyCoverage: 'country-name-only',
  };

  const geography = await loadGeographyIndex(normalized);
  if (geography) {
    base.locationTerms = mergeUnique(base.locationTerms, geography.attributionTerms || []);
    base.ambiguousLocationTerms = geography.ambiguousTerms || [];
    base.geographySearchTerms = mergeUnique([], geography.discoveryTerms || []);
    base.geographyCoverage = 'generated-global-index';
    base.geography = {
      source: geography.source,
      counts: geography.counts,
      contentSha256: geography.contentSha256 || geography.source?.sha256 || null,
    };
  }

  const filename = COUNTRY_OVERRIDE_FILES.get(normalized);
  let config = base;

  if (filename) {
    const configPath = path.join(ROOT, 'config', 'countries', filename);
    const raw = await readFile(configPath, 'utf8');
    const override = JSON.parse(raw);

    config = {
      ...base,
      ...override,
      countryAliases: mergeUnique(base.countryAliases, override.countryAliases || []),
      exactCountryAliases: mergeUnique(base.exactCountryAliases, override.exactCountryAliases || []),
      locationTerms: mergeUnique(base.locationTerms, override.locationTerms || []),
      curatedLocationTerms: mergeUnique([], override.locationTerms || []),
      ambiguousLocationTerms: base.ambiguousLocationTerms,
      searchTerms: mergeUnique(base.searchTerms, override.searchTerms || []),
      geographySearchTerms: base.geographySearchTerms,
      geographyCoverage: geography ? 'generated-global-index+country-overrides' : 'curated-poc',
    };
  }

  validateCountryConfig(config);
  return prepareLookups(config);
}

async function loadGeographyIndex(code) {
  try {
    const raw = await readFile(path.join(ROOT, 'geography', `${code}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.country?.code !== code) {
      throw new Error(`Geography index country mismatch for ${code}`);
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function prepareLookups(config) {
  return {
    ...config,
    locationTermLookup: new Set(config.locationTerms.map(canonicalize)),
    ambiguousLocationTermLookup: new Set(config.ambiguousLocationTerms.map(canonicalize)),
    curatedLocationTerms: config.curatedLocationTerms || [],
  };
}

function canonicalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeUnique(first, second) {
  return [...new Set([...(first || []), ...(second || [])])];
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

  for (const key of [
    'locationTerms',
    'curatedLocationTerms',
    'ambiguousLocationTerms',
    'geographySearchTerms',
  ]) {
    if (!Array.isArray(config[key])) {
      throw new Error(`Invalid country config: ${key} must be an array`);
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
