const COMMON_REGION_ALIASES = new Map([
  ['usa', 'US'],
  ['u s a', 'US'],
  ['uk', 'GB'],
  ['u k', 'GB'],
  ['uae', 'AE'],
  ['u a e', 'AE'],
]);

let regionNames;

function canonicalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
}

function containsPhrase(haystack, phrase) {
  const normalizedPhrase = canonicalize(phrase);
  if (!normalizedPhrase) return false;
  return ` ${haystack} `.includes(` ${normalizedPhrase} `);
}

function getRegionNames() {
  if (regionNames) return regionNames;

  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const found = new Map();

  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      const name = displayNames.of(code);
      if (!name || name === code || name === 'Unknown Region') continue;
      found.set(canonicalize(name), code);
    }
  }

  for (const [alias, code] of COMMON_REGION_ALIASES) {
    found.set(alias, code);
  }

  regionNames = [...found.entries()].sort((a, b) => b[0].length - a[0].length);
  return regionNames;
}

function explicitForeignRegions(normalizedLocation, targetCode) {
  const matches = new Map();

  for (const [name, code] of getRegionNames()) {
    if (code === targetCode) continue;
    if (containsPhrase(normalizedLocation, name)) {
      matches.set(code, name);
    }
  }

  return [...matches.entries()].map(([code, name]) => ({ code, name }));
}

export function attributeLocation(location, config) {
  const raw = String(location || '').trim();
  if (!raw) {
    return {
      accepted: false,
      confidence: 'unknown',
      evidence: 'missing-location',
      matched: null,
    };
  }

  const normalized = canonicalize(raw);
  const explicitCountryAlias = config.countryAliases.find((alias) => containsPhrase(normalized, alias));
  const exactCountryAlias = config.exactCountryAliases.find((alias) => {
    const exact = canonicalize(alias);
    const tokens = normalized.split(' ');
    return normalized === exact || tokens.at(-1) === exact;
  });
  const foreignRegions = explicitForeignRegions(normalized, config.code);

  if ((explicitCountryAlias || exactCountryAlias) && foreignRegions.length > 0) {
    return {
      accepted: false,
      confidence: 'ambiguous',
      evidence: 'multiple-countries',
      matched: null,
      conflicts: foreignRegions,
    };
  }

  if (foreignRegions.length > 0) {
    return {
      accepted: false,
      confidence: 'unknown',
      evidence: 'foreign-country',
      matched: null,
      conflicts: foreignRegions,
    };
  }

  if (explicitCountryAlias) {
    return {
      accepted: true,
      countryCode: config.code,
      confidence: 'high',
      evidence: 'explicit-country',
      matched: explicitCountryAlias,
    };
  }

  if (exactCountryAlias) {
    return {
      accepted: true,
      countryCode: config.code,
      confidence: 'high',
      evidence: 'country-code',
      matched: exactCountryAlias,
    };
  }

  for (const candidate of locationCandidates(raw)) {
    if (config.ambiguousLocationTermLookup?.has(candidate)) {
      return {
        accepted: false,
        confidence: 'ambiguous',
        evidence: 'ambiguous-place',
        matched: candidate,
      };
    }

    if (config.locationTermLookup?.has(candidate)) {
      return {
        accepted: true,
        countryCode: config.code,
        confidence: 'medium',
        evidence: 'recognized-place',
        matched: candidate,
      };
    }
  }

  // Country-specific hand-curated terms are intentionally allowed as
  // substring evidence for backward compatibility with known local cases.
  for (const term of config.curatedLocationTerms || []) {
    if (containsPhrase(normalized, term)) {
      return {
        accepted: true,
        countryCode: config.code,
        confidence: 'medium',
        evidence: 'curated-location',
        matched: term,
      };
    }
  }

  return {
    accepted: false,
    confidence: 'unknown',
    evidence: 'unrecognized-location',
    matched: null,
  };
}

export function normalizeLocationForComparison(value) {
  return canonicalize(value);
}

function locationCandidates(value) {
  const raw = String(value || '');
  const candidates = new Set([canonicalize(raw)]);

  for (const part of raw.split(/[,/|;]+/)) {
    const normalized = canonicalize(part);
    if (normalized) candidates.add(normalized);
  }

  return [...candidates].filter(Boolean);
}
