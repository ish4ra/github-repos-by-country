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

test('known Sri Lankan city without country is medium confidence', () => {
  const result = attributeLocation('Kalutara', config);
  assert.equal(result.accepted, true);
  assert.equal(result.confidence, 'medium');
  assert.equal(result.evidence, 'recognized-location');
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

test('location normalization is deterministic', () => {
  assert.equal(normalizeLocationForComparison(' Nuwara-Eliya,  Sri Lanka '), 'nuwara eliya sri lanka');
});
