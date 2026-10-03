# Roadmap

This file records the project-wide coverage requirements so they are not lost while the implementation evolves.

## Non-negotiable geography coverage

The finished project must not depend on a short hand-maintained list of major cities.

Target coverage:

- all 249 ISO 3166-1 countries and territories
- Kosovo as an additional commonly used GitHub location region (`XK`)
- country names, ISO codes, common abbreviations, aliases, and common spelling variants
- cities and towns
- first-level and useful lower-level administrative regions
- common alternate and ASCII place names
- explicit ambiguity handling for place names shared by multiple countries

The production geography index starts from the Countries States Cities Database, pinned to a verified release, and is enriched from the official GeoNames gazetteer. The GeoNames cities500 layer adds cities with population over 500 plus administrative seats through PPLA4. The project stores compact per-country discovery/attribution indexes rather than raw upstream dumps.

A city-only GitHub profile must not be silently assigned to a country when the city name is ambiguous. A global ambiguity map is the next layer after the compact geography files are generated.

## Discovery accuracy

GitHub search result limits must not be treated as if they were complete datasets.

The global discovery design must:

1. detect capped searches
2. shard broad searches deterministically
3. merge and deduplicate results across shards
4. preserve discovery state between refreshes when required
5. use complementary discovery paths so a high-star repository is not lost merely because its owner has few followers
6. expose unresolved coverage gaps in generated metadata
7. process the 146k+ generated geography discovery terms incrementally with persistent per-country progress
8. retain a safety pool of high-potential owners and re-probe it before publishing each completed country
9. checkpoint the active search shard and pagination cursor so a large location query can resume without restarting

## Repository rankings

Every live country page should provide:

- rank
- repository and owner
- stars and forks
- primary language
- owner location
- attribution evidence/confidence
- last update timestamp
- raw JSON data
- coverage diagnostics

The initial ranking is by stars. Fork, growth/trending, activity, and language views can be added later.

## Users by country

After the repository-country engine is globally stable, build an accurate users-by-country dataset and rankings.

The new user system must not copy the discovery limitations of the older `top-github-users` implementation. In particular, it must account for city-only locations, aliases such as `Srilanka`, broader geography coverage, ambiguous place names, and GitHub search caps.

Planned user views:

- followers
- public contributions
- contribution metrics with clearly documented time windows
- country and city browsing
- machine-readable JSON
- shared geography/attribution engine with the repository rankings

## Unified website

The later website should combine repository and user data under one searchable interface:

```text
GitHub by Country
├── Countries
├── Repositories
│   ├── Stars
│   ├── Forks
│   └── Trending
├── Developers
│   ├── Followers
│   └── Contributions
└── Maps and comparisons
```
