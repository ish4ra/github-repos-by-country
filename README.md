# GitHub Repositories by Country

Discover and rank GitHub repositories by country using public GitHub data.

> **Status:** Experimental proof of concept. Sri Lanka is the first supported country while the discovery and country-attribution methodology is validated.

## What it does

GitHub Repositories by Country builds reproducible country-level rankings for public GitHub repositories, starting with repositories ordered by stars.

The first pipeline:

- discovers GitHub users and organizations through country/city location searches
- validates each returned public profile location locally
- retrieves each accepted owner's top public non-fork repositories
- ranks repositories by stars, then forks
- writes machine-readable JSON and a human-readable Markdown ranking
- records coverage limitations and capped searches in the generated data
- refreshes automatically with GitHub Actions

## Why country attribution needs a methodology

GitHub repositories do not have a native country field.

This project currently infers repository country from the repository owner's **public GitHub profile location**. An explicit country match is stronger evidence than a city-only match, and missing or unrecognized locations are excluded instead of guessed.

Country attribution is not a statement of citizenship, nationality, legal incorporation, contributor geography, or where development physically occurs.

See [Methodology](docs/METHODOLOGY.md) for the exact rules and limitations.

## Sri Lanka proof of concept

The first supported country is Sri Lanka (`LK`). It uses the country name plus configured Sri Lankan city and district terms for owner discovery.

Current defaults:

- up to 100 search results per GraphQL page
- up to 10 pages per location query
- top 25 non-fork public repositories per discovered owner
- top 100 repositories published in the country ranking
- archived repositories remain visible and are marked

The generated ranking does **not** claim exhaustive national coverage yet. GitHub search caps, free-form profile locations, missing locations, and the per-owner repository limit are explicitly recorded as coverage constraints.

## Generated files

After a successful refresh:

```text
data/LK.json               machine-readable ranking + coverage metadata
rankings/sri-lanka.md      human-readable ranking
```

## Project structure

```text
.github/workflows/         CI and scheduled refresh workflows
config/countries/          country-specific discovery configuration
docs/                      methodology documentation
src/                       GitHub client, attribution, ranking and output pipeline
tests/                     Node.js built-in test suite
data/                      generated JSON datasets
rankings/                  generated Markdown rankings
```

## Requirements

- Node.js 22 or newer
- a GitHub token for GraphQL requests

No runtime npm dependencies are required.

## Run locally

```bash
export GITHUB_TOKEN=your_token_here
npm run check
npm run generate:sri-lanka
```

On Windows PowerShell:

```powershell
$env:GITHUB_TOKEN="your_token_here"
npm run check
npm run generate:sri-lanka
```

The token is only used to query GitHub. Do not commit it to the repository.

## Automation

`CI` validates syntax and runs tests on pushes and pull requests.

`Refresh Sri Lanka ranking` runs daily and can also be started manually. It uses the repository's built-in GitHub Actions token, regenerates the two ranking files, and commits only when generated data changes.

## Ranking rules

Repositories are sorted by:

1. stars descending
2. forks descending
3. `owner/name` ascending as a deterministic tie-breaker

Forks are excluded. Repository star/fork metadata comes from GitHub at generation time.

## Accuracy principles

1. GitHub-sourced repository statistics are kept separate from inferred country attribution.
2. Attribution evidence and confidence are included in generated JSON.
3. Ambiguous or unrecognized locations should not be silently guessed.
4. Rankings should not depend on a manually selected list of popular developers.
5. Generated datasets include timestamps, methodology versions, coverage statistics, and search-cap warnings.
6. The project should disclose known incompleteness instead of presenting approximate discovery as a complete census.

## Roadmap

The next milestones are:

- validate the Sri Lanka output against known repositories and missed-owner cases
- improve geography normalization and explicit ambiguity handling
- add repo-centric discovery checks to reduce owner-search blind spots
- expand to additional countries
- add historical snapshots for star growth and trending rankings
- modernize country-level developer rankings
- build a unified website for repositories, developers, countries, and map views

## License

Code is licensed under the [MIT License](LICENSE).

Generated data is derived from public GitHub API responses. Any future third-party geography dataset will retain its own license and attribution requirements.
