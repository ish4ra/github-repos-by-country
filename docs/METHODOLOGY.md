# Methodology

## Goal

GitHub Repositories by Country ranks public repositories by repository statistics while keeping country attribution explicit and auditable.

The first proof of concept covers Sri Lanka (`LK`).

## Repository country

GitHub does not expose a native country field on repositories. The project therefore attributes a repository to the public profile location of its owner.

For the Sri Lanka proof of concept:

1. An explicit `Sri Lanka`-style country match is **high confidence**.
2. An `LK`/`LKA` country-code style match is **high confidence** when it appears as the complete location or final location token.
3. A recognized Sri Lankan city or district without an explicit country is **medium confidence**.
4. An explicit foreign-country match rejects a city-only match, and locations naming Sri Lanka plus another country are treated as ambiguous.
5. Empty or unrecognized locations are excluded.

This attribution is not a statement about citizenship, nationality, legal incorporation, contributor geography, or where development physically occurs.

## Owner discovery

The crawler performs separate GitHub user-search queries for the country name and configured Sri Lankan city/district terms. Results are deduplicated by GitHub login.

Discovery requests intentionally fetch only lightweight owner metadata. Repositories are fetched in a second phase, in batches of GitHub node IDs. Keeping these phases separate avoids oversized nested GraphQL search queries and makes retry/rate-limit behavior more predictable.

The returned public profile location is validated again locally. A search hit is not automatically accepted merely because GitHub returned it for a location query.

Both individual users and organizations can be included when returned by GitHub's user search.

## Repository discovery

After owner discovery is complete, accepted owner node IDs are processed in batches. For each owner, the GraphQL query requests the owner's top non-fork public repositories ordered by `STARGAZERS` descending.

The proof of concept currently retrieves the top 25 repositories per discovered owner and publishes the top 100 repositories across the country after deduplication.

Forks are excluded from the ranking. Archived repositories remain visible and are marked as archived.

## Ranking

Repositories are ordered by:

1. stars, descending
2. forks, descending
3. `owner/name`, ascending as a deterministic final tie-breaker

Stars and forks are read directly from GitHub at generation time.

## Coverage and known limitations

This proof of concept deliberately does **not** claim exhaustive national coverage.

Important limitations include:

- GitHub profile location is self-reported and free-form.
- Owners can omit their location or use a location term not present in the country configuration.
- Broad GitHub search queries can expose only a capped portion of matching search results.
- City-only matches are weaker evidence than an explicit country name.
- Only a configured number of top repositories are retrieved per owner.
- Distributed organizations may not have a single meaningful country even if the organization profile has a location.

Generated JSON includes coverage metadata and any search terms that were capped during collection.

## Accuracy policy

The project prefers an explicit `unknown`/excluded result over silently guessing a country.

Before the project expands globally, the country-attribution layer should be upgraded to a broader geography dataset with explicit ambiguity handling and a documented dataset license.
