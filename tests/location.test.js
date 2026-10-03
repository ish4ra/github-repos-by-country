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
  assert.equal(result.evidence, 'country-code');
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
