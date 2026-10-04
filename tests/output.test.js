import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCountryProgressPage, renderMarkdown, renderRankingsIndex } from '../src/output.js';

const ranking = {
  country: { code: 'LK', name: 'Sri Lanka', slug: 'sri-lanka' },
  generatedAt: '2026-10-03T00:00:00.000Z',
  methodologyVersion: '0.2.0-poc',
  coverage: {
    rawOwnerHits: 10,
    acceptedUniqueOwners: 1,
    repositoriesConsidered: 1,
    publishedRepositories: 1,
    candidateThresholdStars: 42,
    cappedQueries: ['Sri Lanka'],
    notes: ['Example note'],
  },
  repositories: [
    {
      rank: 1,
      nameWithOwner: 'owner/project',
      url: 'https://github.com/owner/project',
      description: 'A useful project',
      stars: 42,
      forks: 7,
      primaryLanguage: 'JavaScript',
      archived: false,
      owner: {
        login: 'owner',
        url: 'https://github.com/owner',
        location: 'Colombo | Sri Lanka',
      },
    },
  ],
};

test('country ranking renders navigation, summary and visual repository table', () => {
  const markdown = renderMarkdown(ranking);

  assert.match(markdown, /Browse countries/);
  assert.match(markdown, /JSON data/);
  assert.match(markdown, /<table>/);
  assert.match(markdown, /owner\/project/);
  assert.match(markdown, /github\.com\/owner\.png\?size=64/);
  assert.match(markdown, /Colombo \| Sri Lanka/);
  assert.match(markdown, /Capped search terms/);
});

test('rankings index shows live and queued countries', () => {
  const markdown = renderRankingsIndex(
    [ranking],
    [
      { code: 'JP', name: 'Japan', slug: 'japan', flag: '🇯🇵' },
      { code: 'LK', name: 'Sri Lanka', slug: 'sri-lanka', flag: '🇱🇰' },
    ],
  );

  assert.match(markdown, /2 countries and territories indexed/);
  assert.match(markdown, /Japan.*Queued/);
  assert.match(markdown, /Sri Lanka.*Live/);
  assert.match(markdown, /sri-lanka\.md/);
});


test('rankings index shows resumable build progress without claiming it is live', () => {
  const markdown = renderRankingsIndex(
    [],
    [{ code: 'US', name: 'United States', slug: 'united-states', flag: '🇺🇸' }],
    [{
      country: { code: 'US' },
      phase: 'discovery',
      nextTermIndex: 250,
      geography: { termsTotal: 1000 },
      updatedAt: '2026-10-03T00:00:00.000Z',
    }],
  );

  assert.match(markdown, /Building 25%/);
  assert.doesNotMatch(markdown, /Most starred repositories/);
});


test('queued country progress page is viewable before ranking is live', async () => {
  const { renderCountryProgressPage } = await import('../src/output.js');
  const markdown = renderCountryProgressPage(
    { code: 'JP', name: 'Japan', slug: 'japan', flag: '🇯🇵' },
    null,
  );

  assert.match(markdown, /Japan/);
  assert.match(markdown, /Queued/);
  assert.match(markdown, /Browse countries/);
});

test('active country progress page shows crawl percentage', async () => {
  const { renderCountryProgressPage } = await import('../src/output.js');
  const markdown = renderCountryProgressPage(
    { code: 'US', name: 'United States', slug: 'united-states', flag: '🇺🇸' },
    {
      phase: 'discovery',
      nextTermIndex: 25,
      geography: { termsTotal: 100 },
      candidates: [{ login: 'a' }],
      stats: { searchRequests: 10 },
      unresolvedShards: [],
    },
  );

  assert.match(markdown, /Building 25%/);
  assert.match(markdown, /1/);
});


test('building country page can show early repository candidates without calling them final', async () => {
  const { renderCountryProgressPage } = await import('../src/output.js');
  const markdown = renderCountryProgressPage(
    { code: 'JP', name: 'Japan', slug: 'japan', flag: '🇯🇵' },
    {
      phase: 'discovery',
      nextTermIndex: 0,
      geography: { termsTotal: 100 },
      stats: { searchRequests: 1 },
      unresolvedShards: [],
      candidates: [{
        login: 'example',
        location: 'Japan',
        topRepository: {
          nameWithOwner: 'example/project',
          url: 'https://github.com/example/project',
          stargazerCount: 1234,
        },
      }],
    },
  );

  assert.match(markdown, /Early preview/);
  assert.match(markdown, /example\/project/);
  assert.match(markdown, /not the final country ranking/);
});


test('root README is browse-first and shows countries immediately', async () => {
  const { renderRootReadme } = await import('../src/output.js');
  const markdown = renderRootReadme(
    [],
    [
      { code: 'JP', name: 'Japan', slug: 'japan', flag: '🇯🇵' },
      { code: 'LK', name: 'Sri Lanka', slug: 'sri-lanka', flag: '🇱🇰' },
    ],
    [],
  );

  assert.match(markdown, /Browse by country/);
  assert.match(markdown, /rankings\/japan\.md/);
  assert.match(markdown, /rankings\/sri-lanka\.md/);
  assert.match(markdown, /⚪/);
  assert.ok(markdown.indexOf('Browse by country') < markdown.indexOf('How rankings work'));
});

test('root README distinguishes live and building countries', async () => {
  const { renderRootReadme } = await import('../src/output.js');
  const markdown = renderRootReadme(
    [{
      country: { code: 'LK', name: 'Sri Lanka', slug: 'sri-lanka' },
      coverage: { publishedRepositories: 100 },
    }],
    [
      { code: 'JP', name: 'Japan', slug: 'japan', flag: '🇯🇵' },
      { code: 'LK', name: 'Sri Lanka', slug: 'sri-lanka', flag: '🇱🇰' },
    ],
    [{
      country: { code: 'JP' },
      phase: 'discovery',
    }],
  );

  assert.match(markdown, /🟢/);
  assert.match(markdown, /🟡/);
  assert.match(markdown, /1 live · 1 building · 0 queued/);
});


test('country page prefers independent repository-first candidates when available', () => {
  const markdown = renderCountryProgressPage(
    { code: 'US', name: 'United States', slug: 'united-states', flag: '🇺🇸' },
    null,
    {
      country: { code: 'US' },
      scanFrontierStars: 200000,
      repositories: [{
        nameWithOwner: 'torvalds/linux',
        url: 'https://github.com/torvalds/linux',
        stars: 250000,
        forks: 66000,
        owner: { location: 'Portland, OR' },
      }],
    },
  );

  assert.match(markdown, /Repository-first scan/);
  assert.match(markdown, /torvalds\/linux/);
  assert.match(markdown, /Portland, OR/);
  assert.match(markdown, /not.*final|becomes final/i);
});
