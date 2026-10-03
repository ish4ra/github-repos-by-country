import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, getCountry } from '../src/countries.js';
import { loadCountryConfig } from '../src/config.js';

test('global catalog contains 249 ISO entries plus Kosovo', () => {
  assert.equal(COUNTRIES.length, 250);
  assert.equal(new Set(COUNTRIES.map((country) => country.code)).size, 250);
  assert.ok(getCountry('LK'));
  assert.ok(getCountry('US'));
  assert.ok(getCountry('AX'));
  assert.equal(getCountry('XK')?.name, 'Kosovo');
});

test('generic country configuration is available outside Sri Lanka', async () => {
  const config = await loadCountryConfig('JP');
  assert.equal(config.code, 'JP');
  assert.equal(config.name, 'Japan');
  assert.deepEqual(config.searchTerms, ['Japan']);
  assert.equal(config.geographyCoverage, 'country-name-only');
});

test('Sri Lanka keeps its proof-of-concept overrides', async () => {
  const config = await loadCountryConfig('LK');
  assert.equal(config.code, 'LK');
  assert.ok(config.searchTerms.includes('Kalutara'));
  assert.ok(config.countryAliases.includes('srilanka'));
  assert.equal(config.geographyCoverage, 'curated-poc');
});
