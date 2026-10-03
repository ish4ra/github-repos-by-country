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

The returned public profile location is validated again locally. A search hit is not automatically accepted merely because GitHub returned it for a location query.

Both individual users and organizations can be included when returned by GitHub's user search.

## Two-stage repository discovery

Fetching many repositories for every discovered owner is unnecessarily expensive. The ranking therefore uses a two-stage process.

### Stage 1: top-repository probe

Every accepted owner is queried for exactly one repository: their most-starred public, non-fork repository.

The owners are then sorted by that top-repository star count. The star count of the owner at the requested ranking limit becomes the **candidate threshold**.

For a top-100 ranking, an owner whose most-starred repository is below that threshold cannot place any repository in the top 100, because every other repository they own has an equal or lower star count.

All owners tied at the threshold are retained.

### Stage 2: candidate expansion

Only candidate owners are expanded. Each candidate is queried for up to 100 public, non-fork repositories ordered by stars.

Because the requested ranking limit is 100, retrieving up to 100 repositories from each candidate owner is sufficient to construct the top 100 among the discovered owners, including the theoretical case where a single owner occupies every ranking position.

Forks are excluded. Archived repositories remain visible and are marked as archived.

## Ranking

Repositories are ordered by:

1. stars, descending
2. forks, descending
3. `owner/name`, ascending as a deterministic final tie-breaker

Stars and forks are read directly from GitHub at generation time.

## Coverage and known limitations

The two-stage candidate algorithm preserves top-100 correctness **within the set of owners discovered by the location searches**. It does not make owner discovery exhaustive.

This proof of concept therefore deliberately does **not** claim a complete national census.

Important limitations include:

- GitHub profile location is self-reported and free-form.
- Owners can omit their location or use a location term not present in the country configuration.
- Broad GitHub search queries can expose only a capped portion of matching search results.
- City-only matches are weaker evidence than an explicit country name.
- Distributed organizations may not have a single meaningful country even if the organization profile has a location.

Generated JSON includes coverage metadata, the candidate threshold, and any search terms that were capped during collection.

## Reliability

Owner discovery and repository expansion are intentionally separate. Repository batches are small, transient GitHub server failures are retried, and failed batches can be split into smaller batches instead of discarding an entire run.

## Accuracy policy

The project prefers an explicit `unknown`/excluded result over silently guessing a country.

Before the project expands globally, the country-attribution layer should be upgraded to a broader geography dataset with explicit ambiguity handling and a documented dataset license.
