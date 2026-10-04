import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCountryGeographyIndexes,
  extractNameVariants,
  normalizeGeographyTerm,
} from '../src/geography-source.js';

const catalog = [
  { code: 'LK', name: 'Sri Lanka', slug: 'sri-lanka' },
  { code: 'BR', name: 'Brazil', slug: 'brazil' },
];

test('name variants include native and translations for attribution', () => {
  assert.deepEqual(
    new Set(
      extractNameVariants({
        name: 'Colombo',
        native: 'කොළඹ',
        translations: { fr: 'Colombo', xx: 'Kolamba' },
      }),
    ),
    new Set(['Colombo', 'කොළඹ', 'Kolamba']),
  );
});

test('geography builder extracts states and cities per country', () => {
  const indexes = buildCountryGeographyIndexes(
    [
      {
        iso2: 'LK',
        name: 'Sri Lanka',
        states: [
          {
            name: 'Western Province',
            cities: [
              { name: 'Colombo', native: 'කොළඹ' },
              { name: 'Kalutara' },
            ],
          },
        ],
      },
      {
        iso2: 'BR',
        name: 'Brazil',
        states: [{ name: 'Paraná', cities: [{ name: 'Colombo' }] }],
      },
    ],
    catalog,
  );

  const lk = indexes.get('LK');
  assert.equal(lk.counts.states, 1);
  assert.equal(lk.counts.cityRecords, 2);
  assert.ok(lk.attributionTerms.includes('Colombo'));
  assert.ok(lk.attributionTerms.includes('කොළඹ'));
  assert.ok(lk.discoveryTerms.includes('Kalutara'));
  assert.ok(lk.discoveryTerms.includes('Western Province'));

  const normalizedColombo = normalizeGeographyTerm('Colombo');
  assert.ok(lk.ambiguousTerms.includes(normalizedColombo));
  assert.ok(indexes.get('BR').ambiguousTerms.includes(normalizedColombo));
});

test('country-unique city names are not marked ambiguous', () => {
  const indexes = buildCountryGeographyIndexes(
    [
      { iso2: 'LK', name: 'Sri Lanka', states: [{ name: 'Western', cities: [{ name: 'Kalutara' }] }] },
      { iso2: 'BR', name: 'Brazil', states: [{ name: 'Paraná', cities: [{ name: 'Curitiba' }] }] },
    ],
    catalog,
  );

  assert.ok(!indexes.get('LK').ambiguousTerms.includes('kalutara'));
});


test('compound city and admin terms preserve disambiguating state context', () => {
  const indexes = buildCountryGeographyIndexes(
    [
      {
        iso2: 'US',
        name: 'United States',
        states: [{ name: 'Oregon', iso2: 'OR', cities: [{ name: 'Portland', state_code: 'OR' }] }],
      },
      {
        iso2: 'AU',
        name: 'Australia',
        states: [{ name: 'Victoria', iso2: 'VIC', cities: [{ name: 'Portland', state_code: 'VIC' }] }],
      },
    ],
    [
      { code: 'US', name: 'United States', slug: 'united-states' },
      { code: 'AU', name: 'Australia', slug: 'australia' },
    ],
  );

  const us = indexes.get('US');
  assert.ok(us.ambiguousTerms.includes('portland'));
  assert.ok(us.compoundTerms.includes('Portland, Oregon'));
  assert.ok(us.compoundTerms.includes('Portland, OR'));
  assert.ok(indexes.get('AU').compoundTerms.includes('Portland, Victoria'));
});
