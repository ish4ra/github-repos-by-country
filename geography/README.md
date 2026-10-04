# Generated Geography Index

This directory is generated from **Countries States Cities Database** and is used for country attribution and city/admin discovery planning.

- Source repository: https://github.com/dr5hn/countries-states-cities-database
- Pinned release: `v3.2-export.8`
- Source asset: `json-countries+states+cities.json.gz`
- Verified SHA-256: `7e2d16815990f11bbddcd36a49a81528c6da85136f860239c3e8c7bd712cbb4e`
- Source database license: **ODbL-1.0**
- Countries/territories generated: **250**
- City/town/district records represented: **153,312**
- Unique discovery terms across country files: **149,805**

The base files in this directory are generated from the upstream Countries States Cities Database under its ODbL terms. A later enrichment step may merge additional attributed geography sources. Project source code remains under the MIT License.

Do not edit these JSON files manually. Run `npm run sync:geography` instead.
## GeoNames enrichment

The base country/state/city index is additionally enriched from the official
[GeoNames](https://www.geonames.org/) gazetteer using the global `cities500`
extract.

- Source: https://download.geonames.org/export/dump/cities500.zip
- Retrieved: `2026-10-04T02:58:55.679384Z`
- Last-Modified: `Sat, 03 Oct 2026 02:09:53 GMT`
- Download SHA-256: `7c32ce0a1553dba6b5d3ee2a6e14b27bbbda756ecb5c0e812537681a15fc7f3a`
- License: **CC BY 4.0**
- GeoNames city records merged: **235,915**
- Combined discovery terms: **285,178**
- Combined attribution terms: **1,179,293**
- Per-country ambiguous-term memberships: **19,376**

GeoNames documents `cities500` as cities with population greater than 500,
plus administrative seats down to PPLA4. The generated index also retains the
base country/state/city database, so the two sources complement each other.

Generated geography data incorporates upstream datasets with different
licenses. Users of the generated geography files should comply with both the
base database ODbL terms and GeoNames CC BY 4.0 attribution requirements.
