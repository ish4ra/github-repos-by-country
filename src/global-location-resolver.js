import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { COUNTRIES } from './countries.js';
import { projectRoot } from './config.js';
import { normalizeLocationForComparison } from './location.js';

export const LOCATION_RESOLVER_VERSION = 2;

const STRONG_EXACT_REGION_ALIASES = new Map([
  ['hong kong sar', 'HK'],
  ['hong kong s a r', 'HK'],
  ['hong kong sar china', 'HK'],
  ['hong kong special administrative region', 'HK'],
  ['macao', 'MO'],
  ['macau', 'MO'],
  ['macao sar', 'MO'],
  ['macau sar', 'MO'],
  ['macao sar china', 'MO'],
  ['macao special administrative region', 'MO'],
  ['puerto rico', 'PR'],
  ['guam', 'GU'],
  ['american samoa', 'AS'],
  ['northern mariana islands', 'MP'],
  ['u s virgin islands', 'VI'],
  ['united states virgin islands', 'VI'],
]);

export async function loadGlobalLocationResolver() {
  const geographyDir = path.join(projectRoot(), 'geography');
  const entries = await readdir(geographyDir, { withFileTypes: true });
  const indexes = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/^[A-Z]{2}\.json$/.test(entry.name)) continue;
    const parsed = JSON.parse(
      await readFile(path.join(geographyDir, entry.name), 'utf8'),
    );
    if (parsed?.country?.code) indexes.push(parsed);
  }

  return createGlobalLocationResolver({ countries: COUNTRIES, indexes });
}

export function createGlobalLocationResolver({ countries, indexes }) {
  const aliasMap = new Map();
  const termMap = new Map();
  const compoundMap = new Map();
  const countryCodes = new Set();

  for (const country of countries || []) {
    countryCodes.add(country.code);
    for (const value of [country.name, ...(country.aliases || [])]) {
      addMapping(aliasMap, value, country.code);
    }
  }

  for (const index of indexes || []) {
    const code = index?.country?.code;
    if (!code) continue;

    for (const term of index.attributionTerms || []) {
      addMapping(termMap, term, code);
    }
    for (const term of index.compoundTerms || []) {
      addMapping(compoundMap, term, code);
    }
  }

  return {
    resolve(location) {
      const raw = String(location || '').trim();
      if (!raw) return unknown('missing-location');

      const normalized = normalizeLocationForComparison(raw);

      for (const candidate of locationCandidates(raw)) {
        const strongRegion = STRONG_EXACT_REGION_ALIASES.get(candidate);
        if (strongRegion) {
          return accepted(strongRegion, 'high', 'explicit-territory', candidate);
        }
      }

      const compoundCodes = compoundMap.get(normalized);
      if (compoundCodes?.size === 1) {
        const countryCode = [...compoundCodes][0];
        return accepted(countryCode, 'high', 'recognized-place-with-admin', normalized);
      }
      if (compoundCodes?.size > 1) {
        return ambiguous('ambiguous-compound-place', normalized, compoundCodes);
      }

      if (/^[a-z]{2}$/i.test(raw) && countryCodes.has(raw.toUpperCase())) {
        return accepted(raw.toUpperCase(), 'high', 'country-code', raw);
      }

      const evidence = new Map();
      let sawAmbiguity = false;

      for (const candidate of locationCandidates(raw)) {
        const termCodes = termMap.get(candidate);
        const aliasCodes = aliasMap.get(candidate);

        if (termCodes?.size > 1) {
          sawAmbiguity = true;
        } else if (termCodes?.size === 1) {
          addEvidence(evidence, [...termCodes][0], 2, 'recognized-place', candidate);
        }

        if (aliasCodes?.size === 1) {
          const code = [...aliasCodes][0];
          const aliasCollidesWithPlaces =
            termCodes && (termCodes.size > 1 || !termCodes.has(code));

          if (!aliasCollidesWithPlaces) {
            addEvidence(evidence, code, 3, 'explicit-country', candidate);
          } else {
            sawAmbiguity = true;
          }
        } else if (aliasCodes?.size > 1) {
          sawAmbiguity = true;
        }
      }

      if (evidence.size === 1) {
        const [countryCode, item] = [...evidence.entries()][0];
        return accepted(
          countryCode,
          item.score >= 3 ? 'high' : 'medium',
          item.evidence,
          item.matched,
        );
      }

      if (evidence.size > 1) {
        return ambiguous('conflicting-place-evidence', normalized, new Set(evidence.keys()));
      }

      return sawAmbiguity
        ? ambiguous('ambiguous-place', normalized)
        : unknown('unrecognized-location');
    },
    stats: {
      countries: countryCodes.size,
      locationTerms: termMap.size,
      compoundTerms: compoundMap.size,
      countryAliases: aliasMap.size,
    },
  };
}

function addMapping(map, value, code) {
  const normalized = normalizeLocationForComparison(value);
  if (!normalized) return;
  const codes = map.get(normalized) || new Set();
  codes.add(code);
  map.set(normalized, codes);
}

function addEvidence(map, code, score, evidence, matched) {
  const current = map.get(code);
  if (!current || score > current.score) {
    map.set(code, { score, evidence, matched });
  }
}

function locationCandidates(value) {
  const raw = String(value || '');
  const candidates = new Set([normalizeLocationForComparison(raw)]);

  for (const part of raw.split(/[,/|;]+/)) {
    const normalized = normalizeLocationForComparison(part);
    if (normalized) candidates.add(normalized);
  }

  return [...candidates].filter(Boolean);
}

function accepted(countryCode, confidence, evidence, matched) {
  return {
    accepted: true,
    countryCode,
    confidence,
    evidence,
    matched,
  };
}

function ambiguous(evidence, matched, codes = new Set()) {
  return {
    accepted: false,
    confidence: 'ambiguous',
    evidence,
    matched,
    conflicts: [...codes],
  };
}

function unknown(evidence) {
  return {
    accepted: false,
    confidence: 'unknown',
    evidence,
    matched: null,
  };
}
