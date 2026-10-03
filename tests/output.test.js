import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderRankingsIndex } from '../src/output.js';

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

test('rankings index links countries and top repositories', () => {
  const markdown = renderRankingsIndex([ranking]);

  assert.match(markdown, /Browse Repository Rankings/);
  assert.match(markdown, /sri-lanka\.md/);
  assert.match(markdown, /owner\/project/);
  assert.match(markdown, /comprehensive geography catalog/);
});
