import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const GEOGRAPHY_SOURCE = Object.freeze({
  name: 'Countries States Cities Database',
  repository: 'dr5hn/countries-states-cities-database',
  license: 'ODbL-1.0',
  release: 'v3.2-export.8',
  asset: 'json-countries+states+cities.json.gz',
  sha256: '7e2d16815990f11bbddcd36a49a81528c6da85136f860239c3e8c7bd712cbb4e',
  url: 'https://github.com/dr5hn/countries-states-cities-database/releases/download/v3.2-export.8/json-countries%2Bstates%2Bcities.json.gz',
});

export async function downloadGeographyDataset({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }

  const response = await fetchImpl(GEOGRAPHY_SOURCE.url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'github-repos-by-country',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download geography data: HTTP ${response.status}`);
  }

  const compressed = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(compressed).digest('hex');

  if (digest !== GEOGRAPHY_SOURCE.sha256) {
    throw new Error(
      `Geography checksum mismatch. Expected ${GEOGRAPHY_SOURCE.sha256}, received ${digest}.`,
    );
  }

  const json = gunzipSync(compressed).toString('utf8');
  return JSON.parse(json);
}

export function buildCountryGeographyIndexes(dataset, catalog) {
  if (!Array.isArray(dataset)) {
    throw new Error('Unexpected geography dataset: root must be an array.');
  }

  const catalogByCode = new Map(catalog.map((country) => [country.code, country]));
  const indexes = new Map();

  for (const country of dataset) {
    const code = normalizeCode(
      country?.iso2 ||
        country?.country_code ||
        country?.countryCode ||
        country?.code,
    );
    if (!code || !catalogByCode.has(code)) continue;

    const catalogCountry = catalogByCode.get(code);
    const attributionTerms = new Set();
    const discoveryTerms = new Set();
    const cityNames = new Set();
    const adminNames = new Set();

    addNameVariants(attributionTerms, country, { includeTranslations: true });
    addNameVariants(discoveryTerms, country, { includeTranslations: false });

    const states = Array.isArray(country.states) ? country.states : [];
    let cityRecords = 0;

    for (const state of states) {
      addNameVariants(attributionTerms, state, { includeTranslations: true });
      addNameVariants(discoveryTerms, state, { includeTranslations: false });
      for (const name of getPrimaryNames(state)) adminNames.add(name);

      const cities = Array.isArray(state?.cities) ? state.cities : [];
      for (const city of cities) {
        cityRecords += 1;
        addNameVariants(attributionTerms, city, { includeTranslations: true });
        addNameVariants(discoveryTerms, city, { includeTranslations: false });
        for (const name of getPrimaryNames(city)) cityNames.add(name);
      }
    }

    // Some export formats can expose cities directly on the country object.
    const directCities = Array.isArray(country.cities) ? country.cities : [];
    for (const city of directCities) {
      cityRecords += 1;
      addNameVariants(attributionTerms, city, { includeTranslations: true });
      addNameVariants(discoveryTerms, city, { includeTranslations: false });
      for (const name of getPrimaryNames(city)) cityNames.add(name);
    }

    attributionTerms.add(catalogCountry.name);
    discoveryTerms.add(catalogCountry.name);

    indexes.set(code, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: {
        name: GEOGRAPHY_SOURCE.name,
        repository: GEOGRAPHY_SOURCE.repository,
        release: GEOGRAPHY_SOURCE.release,
        asset: GEOGRAPHY_SOURCE.asset,
        sha256: GEOGRAPHY_SOURCE.sha256,
        license: GEOGRAPHY_SOURCE.license,
      },
      country: {
        code,
        name: catalogCountry.name,
        slug: catalogCountry.slug,
      },
      counts: {
        states: states.length,
        cityRecords,
        uniquePrimaryCities: cityNames.size,
        uniquePrimaryAdminRegions: adminNames.size,
        attributionTerms: attributionTerms.size,
        discoveryTerms: discoveryTerms.size,
      },
      attributionTerms: sortTerms(attributionTerms),
      discoveryTerms: sortTerms(discoveryTerms),
    });
  }

  const countriesByTerm = new Map();
  for (const [code, index] of indexes) {
    for (const term of index.discoveryTerms) {
      const normalized = normalizeGeographyTerm(term);
      if (!normalized) continue;
      const codes = countriesByTerm.get(normalized) || new Set();
      codes.add(code);
      countriesByTerm.set(normalized, codes);
    }
  }

  for (const [code, index] of indexes) {
    const ambiguous = new Set();
    for (const term of index.discoveryTerms) {
      const normalized = normalizeGeographyTerm(term);
      const codes = countriesByTerm.get(normalized);
      if (codes?.size > 1 && codes.has(code)) ambiguous.add(normalized);
    }

    index.ambiguousTerms = [...ambiguous].sort();
    index.counts.ambiguousTerms = index.ambiguousTerms.length;
  }

  return indexes;
}

export function extractNameVariants(value, { includeTranslations = true } = {}) {
  const found = new Set();

  if (typeof value === 'string') {
    addTerm(found, value);
    return [...found];
  }

  if (!value || typeof value !== 'object') return [];

  for (const field of ['name', 'native', 'ascii_name', 'asciiName']) {
    addTerm(found, value[field]);
  }

  if (includeTranslations && value.translations && typeof value.translations === 'object') {
    for (const translated of Object.values(value.translations)) {
      addTerm(found, translated);
    }
  }

  return [...found];
}

function addNameVariants(target, value, options) {
  for (const name of extractNameVariants(value, options)) {
    target.add(name);
  }
}

function getPrimaryNames(value) {
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (!value || typeof value !== 'object') return [];

  const found = new Set();
  for (const field of ['name', 'native', 'ascii_name', 'asciiName']) {
    addTerm(found, value[field]);
  }
  return [...found];
}

function addTerm(target, value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > 120) return;
  target.add(normalized);
}

function sortTerms(values) {
  return [...values].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function normalizeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}


export function normalizeGeographyTerm(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
