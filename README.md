# GitHub Repositories by Country

Explore the most-starred public GitHub repositories by country with transparent location attribution and reproducible ranking data.

[![CI](https://github.com/ish4ra/github-repos-by-country/actions/workflows/ci.yml/badge.svg)](https://github.com/ish4ra/github-repos-by-country/actions/workflows/ci.yml)
![Countries indexed](https://img.shields.io/badge/countries%20%26%20territories-250-blue)

> **Status:** Global rollout in progress. Sri Lanka is the first live ranking while the geography and discovery engine is being expanded.

## Browse rankings

| Country | Ranking | Raw data |
| --- | --- | --- |
| 🇱🇰 **Sri Lanka** | [Most starred repositories](rankings/sri-lanka.md) | [JSON](data/LK.json) |

### [Browse all 250 countries and territories →](rankings/README.md)

The catalog includes all 249 ISO 3166-1 countries/territories plus Kosovo (`XK`). Countries without generated ranking data are shown as **Queued** instead of being hidden.

## Accuracy first

GitHub repositories do not contain a native country field. Country attribution therefore depends on the repository owner's public GitHub profile location.

The project is being built around these rules:

- do not guess ambiguous locations
- do not rely on a tiny hand-maintained major-city list
- do not treat GitHub's capped search results as a complete census
- keep GitHub-sourced repository statistics separate from inferred geography
- record methodology versions, timestamps, capped searches, and coverage gaps

The global geography target covers countries, cities, towns, administrative regions, aliases, and common spelling variants. See [Roadmap](docs/ROADMAP.md) and [Methodology](docs/METHODOLOGY.md).

## Current ranking pipeline

The Sri Lanka proof of concept uses a two-stage repository discovery algorithm:

1. discover candidate repository owners from location searches
2. validate their public locations
3. probe each accepted owner's most-starred public non-fork repository
4. calculate the top-100 candidate cutoff
5. deeply fetch only owners who can still affect the top 100
6. publish Markdown and JSON

This preserves top-ranking correctness within the discovered owner set while keeping GraphQL usage practical.

## Why the global version is broader

The older reference project currently indexes 138 country entries and only a small manually configured set of cities for each country.

This project indexes **250 country/territory regions** from the start and is being designed around comprehensive geography data rather than a fixed list of a few cities.

## Project structure

```text
.github/workflows/         CI and data-refresh workflows
config/countries/          country-specific overrides where required
data/                      generated machine-readable datasets
docs/                      methodology and roadmap
rankings/                  global country index and rankings
src/                       discovery, geography, ranking and output pipeline
tests/                     automated tests
```

## Run locally

Requirements: Node.js 22+ and a GitHub token.

```bash
export GITHUB_TOKEN=your_token_here
npm run check
npm run generate:sri-lanka
```

PowerShell:

```powershell
$env:GITHUB_TOKEN="your_token_here"
npm run check
npm run generate:sri-lanka
```

Do not commit your token.

## Next milestones

- integrate comprehensive global city/town/admin geography data
- shard capped GitHub searches so owners are not silently missed
- roll out repository rankings across the full 250-region catalog
- add complementary repository-first discovery checks
- build the improved users-by-country ranking engine
- combine repositories and developers in a searchable website

## License

Code is licensed under the [MIT License](LICENSE).

Generated ranking data is derived from public GitHub API responses. External geography data will retain its own attribution and license requirements.
