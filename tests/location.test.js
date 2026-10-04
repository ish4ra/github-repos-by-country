import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCountryConfig } from '../src/config.js';
import { attributeLocation, normalizeLocationForComparison } from '../src/location.js';

const config = await loadCountryConfig('LK');

test('explicit Sri Lanka country name is high confidence', () => {
  const result = attributeLocation('Colombo, Sri Lanka', config);
  assert.equal(result.accepted, true);
  assert.equal(result.countryCode, 'LK');
  assert.equal(result.confidence, 'high');
  assert.equal(result.evidence, 'explicit-country');
});

test('known Sri Lankan city without country is accepted when unambiguous or curated', () => {
  const result = attributeLocation('Kalutara', config);
  assert.equal(result.accepted, true);
  assert.equal(result.confidence, 'medium');
});

test('country code suffix is accepted', () => {
  const result = attributeLocation('Colombo, LK', config);
  assert.equal(result.accepted, true);
  assert.equal(result.confidence, 'high');
  assert.equal(result.evidence, 'country-code-with-place');
});

test('missing and unrelated locations are rejected', () => {
  assert.equal(attributeLocation('', config).accepted, false);
  assert.equal(attributeLocation('Berlin, Germany', config).accepted, false);
});

test('foreign country disambiguates a shared city name', () => {
  const result = attributeLocation('Colombo, Brazil', config);
  assert.equal(result.accepted, false);
  assert.equal(result.evidence, 'foreign-country');
});

test('multiple explicit countries are treated as ambiguous', () => {
  const result = attributeLocation('Sri Lanka / Singapore', config);
  assert.equal(result.accepted, false);
  assert.equal(result.confidence, 'ambiguous');
  assert.equal(result.evidence, 'multiple-countries');
});

test('generated ambiguous city-only terms are rejected', () => {
  const custom = {
    ...config,
    ambiguousLocationTermLookup: new Set(['colombo']),
    locationTermLookup: new Set(['colombo']),
    curatedLocationTerms: [],
  };
  const result = attributeLocation('Colombo', custom);
  assert.equal(result.accepted, false);
  assert.equal(result.evidence, 'ambiguous-place');
});

test('location normalization is deterministic', () => {
  assert.equal(normalizeLocationForComparison(' Nuwara-Eliya,  Sri Lanka '), 'nuwara eliya sri lanka');
});


test('Unicode place names survive normalization and can match generated locations', () => {
  const unicodeConfig = {
    ...config,
    countryAliases: ['Sri Lanka'],
    exactCountryAliases: ['lk'],
    locationTermLookup: new Set(['කොළඹ']),
    ambiguousLocationTermLookup: new Set(),
    curatedLocationTerms: [],
  };
  const result = attributeLocation('කොළඹ', unicodeConfig);
  assert.equal(result.accepted, true);
  assert.equal(result.evidence, 'recognized-place');
  assert.equal(normalizeLocationForComparison('කොළඹ'), 'කොළඹ');
});


test('ambiguous city becomes attributable when admin context is recognized', () => {
  const usConfig = {
    ...config,
    code: 'US',
    countryAliases: ['United States', 'USA'],
    exactCountryAliases: ['us'],
    locationTermLookup: new Set(['portland', 'oregon']),
    compoundLocationTermLookup: new Set(['portland or', 'portland oregon']),
    ambiguousLocationTermLookup: new Set(['portland']),
    curatedLocationTerms: [],
  };

  const result = attributeLocation('Portland, OR', usConfig);
  assert.equal(result.accepted, true);
  assert.equal(result.countryCode, 'US');
  assert.equal(result.confidence, 'high');
  assert.equal(result.evidence, 'recognized-place-with-admin');
});

test('ambiguous city without admin context remains rejected', () => {
  const usConfig = {
    ...config,
    code: 'US',
    countryAliases: ['United States', 'USA'],
    exactCountryAliases: ['us'],
    locationTermLookup: new Set(['portland']),
    compoundLocationTermLookup: new Set(['portland or']),
    ambiguousLocationTermLookup: new Set(['portland']),
    curatedLocationTerms: [],
  };

  const result = attributeLocation('Portland', usConfig);
  assert.equal(result.accepted, false);
  assert.equal(result.evidence, 'ambiguous-place');
});


test('generated US geography resolves Portland, OR as United States', async () => {
  const usConfig = await loadCountryConfig('US');
  const result = attributeLocation('Portland, OR', usConfig);

  assert.equal(result.accepted, true);
  assert.equal(result.countryCode, 'US');
  assert.equal(result.confidence, 'high');
  assert.equal(result.evidence, 'recognized-place-with-admin');
});
