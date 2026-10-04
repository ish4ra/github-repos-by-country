import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalLocationResolver } from '../src/global-location-resolver.js';

const countries = [
  { code: 'US', name: 'United States', aliases: ['USA'] },
  { code: 'CA', name: 'Canada', aliases: [] },
  { code: 'AU', name: 'Australia', aliases: [] },
  { code: 'GE', name: 'Georgia', aliases: [] },
  { code: 'GB', name: 'United Kingdom', aliases: ['UK'] },
  { code: 'HK', name: 'Hong Kong', aliases: ['Hong Kong SAR'] },
  { code: 'PR', name: 'Puerto Rico', aliases: [] },
];

const indexes = [
  {
    country: { code: 'US' },
    attributionTerms: ['United States', 'Oregon', 'Georgia', 'San Francisco', 'Portland'],
    compoundTerms: ['Portland, OR', 'Portland, Oregon', 'San Francisco, CA'],
  },
  {
    country: { code: 'CA' },
    attributionTerms: ['Canada', 'Toronto'],
    compoundTerms: ['Toronto, ON'],
  },
  {
    country: { code: 'AU' },
    attributionTerms: ['Australia', 'Portland'],
    compoundTerms: ['Portland, Victoria'],
  },
  {
    country: { code: 'GE' },
    attributionTerms: ['Georgia', 'Tbilisi'],
    compoundTerms: [],
  },
  {
    country: { code: 'GB' },
    attributionTerms: ['United Kingdom', 'London'],
    compoundTerms: [],
  },
  {
    country: { code: 'HK' },
    attributionTerms: ['Hong Kong'],
    compoundTerms: [],
  },
  {
    country: { code: 'PR' },
    attributionTerms: ['Puerto Rico'],
    compoundTerms: [],
  },
];

const resolver = createGlobalLocationResolver({ countries, indexes });

test('compound city-state location resolves Linus-style US profile', () => {
  const result = resolver.resolve('Portland, OR');
  assert.equal(result.accepted, true);
  assert.equal(result.countryCode, 'US');
  assert.equal(result.evidence, 'recognized-place-with-admin');
});

test('country code collision does not make San Francisco a Canada match', () => {
  const result = resolver.resolve('San Francisco, CA');
  assert.equal(result.accepted, true);
  assert.equal(result.countryCode, 'US');
});

test('ambiguous city without admin context is not guessed', () => {
  const result = resolver.resolve('Portland');
  assert.equal(result.accepted, false);
  assert.equal(result.confidence, 'ambiguous');
});

test('country/state name collision remains ambiguous by itself', () => {
  const result = resolver.resolve('Georgia');
  assert.equal(result.accepted, false);
});

test('unique city can disambiguate a country/state name collision', () => {
  const result = resolver.resolve('Tbilisi, Georgia');
  assert.equal(result.accepted, true);
  assert.equal(result.countryCode, 'GE');
});

test('country alias disambiguates an otherwise common city', () => {
  const result = resolver.resolve('London, UK');
  assert.equal(result.accepted, true);
  assert.equal(result.countryCode, 'GB');
  assert.equal(result.confidence, 'high');
});


test('Hong Kong SAR is attributed to the HK territory, not mainland China geography', () => {
  const result = resolver.resolve('Hong Kong SAR');
  assert.equal(result.accepted, true);
  assert.equal(result.countryCode, 'HK');
  assert.equal(result.confidence, 'high');
  assert.equal(result.evidence, 'explicit-territory');
});

test('exact Puerto Rico territory name wins over parent-country geography overlap', () => {
  const result = resolver.resolve('Puerto Rico');
  assert.equal(result.accepted, true);
  assert.equal(result.countryCode, 'PR');
  assert.equal(result.evidence, 'explicit-territory');
});
