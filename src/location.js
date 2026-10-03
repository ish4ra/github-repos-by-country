function canonicalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(haystack, phrase) {
  const normalizedPhrase = canonicalize(phrase);
  if (!normalizedPhrase) return false;
  return ` ${haystack} `.includes(` ${normalizedPhrase} `);
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

  for (const alias of config.countryAliases) {
    if (containsPhrase(normalized, alias)) {
      return {
        accepted: true,
        countryCode: config.code,
        confidence: 'high',
        evidence: 'explicit-country',
        matched: alias,
      };
    }
  }

  for (const alias of config.exactCountryAliases) {
    const exact = canonicalize(alias);
    const tokens = normalized.split(' ');
    if (normalized === exact || tokens.at(-1) === exact) {
      return {
        accepted: true,
        countryCode: config.code,
        confidence: 'high',
        evidence: 'country-code',
        matched: alias,
      };
    }
  }

  for (const term of config.locationTerms) {
    if (containsPhrase(normalized, term)) {
      return {
        accepted: true,
        countryCode: config.code,
        confidence: 'medium',
        evidence: 'recognized-location',
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
