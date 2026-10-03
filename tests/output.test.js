import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/output.js';

test('markdown output includes warning and ranking table', () => {
  const markdown = renderMarkdown({
    country: { code: 'LK', name: 'Sri Lanka', slug: 'sri-lanka' },
    generatedAt: '2026-10-03T00:00:00.000Z',
    methodologyVersion: '0.1.0-poc',
    coverage: {
      acceptedUniqueOwners: 1,
      repositoriesConsidered: 1,
      publishedRepositories: 1,
      notes: ['Example note'],
    },
    repositories: [
      {
        rank: 1,
        nameWithOwner: 'owner/project',
        url: 'https://github.com/owner/project',
        stars: 42,
        forks: 7,
        primaryLanguage: 'JavaScript',
        archived: false,
        owner: { location: 'Colombo | Sri Lanka' },
      },
    ],
  });

  assert.match(markdown, /Experimental ranking/);
  assert.match(markdown, /\| 1 \| \[owner\/project\]/);
  assert.match(markdown, /Colombo \\| Sri Lanka/);
});
