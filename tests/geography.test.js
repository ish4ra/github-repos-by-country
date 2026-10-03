import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCountryGeographyIndexes, extractNameVariants } from '../src/geography-source.js';

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

  const br = indexes.get('BR');
  assert.ok(br.discoveryTerms.includes('Colombo'));
});
