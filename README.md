# GitHub Repositories by Country

Discover and rank GitHub repositories by country using public GitHub data.

> **Status:** Early development. The project is currently defining and validating its country-attribution methodology before global ranking data is published.

## Overview

GitHub Repositories by Country aims to build transparent, reproducible country-level rankings for public GitHub repositories, starting with repositories ordered by stars.

The long-term goal is to provide an open dataset and ranking engine that can power country pages, comparisons, maps, and a modern web interface for exploring GitHub activity around the world.

## Planned Rankings

The initial focus is:

- Most-starred repositories by country
- Stars, forks, primary language, license, topics, and activity metadata
- Individual and organization-owned repositories
- Country-level JSON datasets
- Human-readable Markdown rankings
- Automated refreshes with GitHub Actions

Future ranking views may include:

- Most-forked repositories
- Fastest-growing repositories
- Stars gained over time
- Language breakdowns by country
- Repository activity and freshness

## Country Attribution

GitHub repositories do not have a native country field.

For that reason, this project will infer a repository's country from public GitHub information associated with its owner. The first implementation will primarily use the public location of the repository owner, whether that owner is a user or an organization.

Location strings will be normalized against a curated geography dataset and ISO country codes. Ambiguous locations will not be force-assigned.

Possible attribution states include:

- **High confidence:** explicit country match
- **Medium confidence:** recognized city or region with a reliable country mapping
- **Ambiguous:** location could refer to more than one country or region
- **Unknown:** insufficient public location information

Country attribution is therefore an inference, not a statement of citizenship, nationality, company registration, or legal origin.

## Accuracy Principles

The project is being designed around a few rules:

1. Repository statistics such as stars and forks should come directly from GitHub.
2. Country attribution should be explainable and reproducible.
3. Ambiguous data should remain ambiguous instead of being guessed.
4. Rankings should not depend only on a preselected list of popular developers.
5. Forks, archived repositories, and other special cases should be clearly identified.
6. Every published country dataset should include its generation timestamp and methodology version.

## Why This Project?

GitHub provides excellent global repository data, but repositories themselves do not include a country field.

Existing country-focused projects often rank developers, while GitHub's Innovation Graph provides useful geographic aggregate statistics. This project explores a different question:

**What are the most-starred public GitHub repositories associated with each country?**

## Initial Development Plan

The first milestone is a Sri Lanka proof of concept.

It will be used to validate:

- owner discovery
- user and organization location parsing
- location normalization
- repository discovery
- star-based ranking
- duplicate handling
- ambiguous-location handling
- GitHub API rate-limit behavior
- generated JSON and Markdown output

After validation, the same pipeline can be expanded to additional countries and eventually a global dataset.

## Data Sources

The project will rely on public GitHub data retrieved through GitHub's APIs.

No private profile information, IP-derived location data, or non-public repository data is intended to be used.

## Repository Structure

The exact structure is still being implemented, but the project is expected to separate:

```text
src/          ranking and data pipeline
data/         generated country datasets
rankings/     generated human-readable rankings
config/       geography and project configuration
tests/        automated tests
.github/      CI and scheduled refresh workflows
```

## Contributing

The project is in early development. Contributions, methodology reviews, location-normalization improvements, and accuracy reports will be welcome once the first working dataset is published.

## License

A project license will be added before the first public data release. Any third-party datasets used for geography normalization will retain their own applicable licenses and attribution requirements.
