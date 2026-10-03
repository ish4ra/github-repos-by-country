# GitHub Repositories by Country

Explore the most-starred public GitHub repositories by country with transparent location attribution and reproducible ranking data.

[![CI](https://github.com/ish4ra/github-repos-by-country/actions/workflows/ci.yml/badge.svg)](https://github.com/ish4ra/github-repos-by-country/actions/workflows/ci.yml)
[![Refresh Sri Lanka](https://github.com/ish4ra/github-repos-by-country/actions/workflows/refresh-sri-lanka.yml/badge.svg)](https://github.com/ish4ra/github-repos-by-country/actions/workflows/refresh-sri-lanka.yml)

> **Status:** Experimental. Sri Lanka is the first live country while discovery accuracy is hardened for global rollout.

## Browse rankings

| Country | Ranking | Raw data |
| --- | --- | --- |
| 🇱🇰 **Sri Lanka** | [Most starred repositories](rankings/sri-lanka.md) | [JSON](data/LK.json) |

**[Browse all country rankings →](rankings/README.md)**

## What you get

Each country page is designed to be easy to scan and includes repository rank, owner, stars, forks, language, owner location, update time, coverage statistics, and direct links to the raw JSON and methodology.

The ranking pipeline:

1. discovers candidate users and organizations from public GitHub location data
2. normalizes and validates owner locations
3. probes every accepted owner's most-starred public non-fork repository
4. expands only owners that can still affect the requested top ranking
5. ranks repositories by stars, then forks, then repository name
6. publishes Markdown and JSON automatically through GitHub Actions

## Accuracy first

GitHub repositories do not have a native country field. Country is inferred from the repository owner's **public GitHub profile location**, so owner discovery and geography normalization matter as much as the ranking itself.

This project intentionally does not hide uncertainty:

- ambiguous or conflicting locations are rejected instead of guessed
- city-only matches are weaker than explicit country matches
- capped GitHub searches are recorded in generated coverage metadata
- generated data includes methodology versions and timestamps
- repository stars/forks come directly from GitHub at generation time

The global version is intended to use a **comprehensive geography catalog**, not a short manually curated city list. The target is coverage for recognized countries, cities, towns, districts/regions, aliases, and common spelling variants while still rejecting ambiguous matches.

See [Methodology](docs/METHODOLOGY.md) for the current rules.

## Current proof of concept

Sri Lanka currently publishes a top-100 repository ranking using a two-stage repository discovery algorithm. Every discovered owner is first queried for only their most-starred repository. Owners whose best repository cannot affect the final top 100 do not require an expensive deep fetch.

This preserves top-ranking correctness **within the discovered owner set** while keeping GraphQL usage practical.

## Project structure

```text
.github/workflows/         CI and scheduled refresh workflows
config/countries/          country-specific discovery configuration
data/                      generated machine-readable datasets
docs/                      methodology documentation
rankings/                  country index and human-readable rankings
src/                       discovery, attribution, ranking and output pipeline
tests/                     Node.js built-in test suite
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

## Roadmap

- replace limited per-country city lists with comprehensive global geography coverage
- shard broad GitHub searches so high-value owners are not lost behind search caps
- add complementary discovery paths to catch owners missed by location search
- expand repository rankings country by country
- build an **accurate GitHub users-by-country dataset and rankings** using the same improved geography/discovery layer
- add historical star growth, trending views, languages, and country comparisons
- build a unified searchable website for repositories, users, countries, and maps

## License

Code is licensed under the [MIT License](LICENSE).

Generated data is derived from public GitHub API responses. Any third-party geography dataset added later will retain its own applicable license and attribution requirements.
