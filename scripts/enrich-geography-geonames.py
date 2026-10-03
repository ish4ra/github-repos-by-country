#!/usr/bin/env python3
"""Merge the official GeoNames cities500 dataset into generated geography indexes."""

from __future__ import annotations

import hashlib
import io
import json
import re
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEOGRAPHY_DIR = ROOT / "geography"
URL = "https://download.geonames.org/export/dump/cities500.zip"
LICENSE = "CC BY 4.0"
SOURCE_NAME = "GeoNames cities500"
MAX_TERM_LENGTH = 120


def normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value or "")
    # Strip the common Latin combining-diacritic block after NFKD so
    # "München" and "Munchen" can normalize together, while preserving
    # combining marks that are semantically required by scripts such as Sinhala.
    without_marks = "".join(
        ch for ch in decomposed
        if not (0x0300 <= ord(ch) <= 0x036F)
    )
    recomposed = unicodedata.normalize("NFC", without_marks)
    lowered = recomposed.lower().replace("&", " and ")
    chars = [
        ch if (ch.isalnum() or unicodedata.category(ch).startswith("M")) else " "
        for ch in lowered
    ]
    return unicodedata.normalize(
        "NFC",
        re.sub(r"\s+", " ", "".join(chars)).strip(),
    )


def clean(value: str) -> str | None:
    value = re.sub(r"\s+", " ", (value or "").strip())
    if not value or len(value) > MAX_TERM_LENGTH:
        return None
    return value


def load_indexes() -> dict[str, dict]:
    indexes: dict[str, dict] = {}
    for path in GEOGRAPHY_DIR.glob("??.json"):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        code = value.get("country", {}).get("code")
        if isinstance(code, str) and len(code) == 2:
            indexes[code] = value
    return indexes


def download() -> tuple[bytes, str, str | None]:
    request = urllib.request.Request(
        URL,
        headers={"User-Agent": "github-repos-by-country"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = response.read()
        last_modified = response.headers.get("Last-Modified")
    digest = hashlib.sha256(payload).hexdigest()
    return payload, digest, last_modified


def add_term(target: set[str], value: str) -> None:
    item = clean(value)
    if item:
        target.add(item)


def main() -> None:
    indexes = load_indexes()
    if len(indexes) < 240:
        raise SystemExit(
            f"Expected generated base geography for at least 240 regions, found {len(indexes)}"
        )

    payload, digest, last_modified = download()
    fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    attribution = {
        code: set(value.get("attributionTerms", []))
        for code, value in indexes.items()
    }
    discovery = {
        code: set(value.get("discoveryTerms", []))
        for code, value in indexes.items()
    }
    geonames_records: defaultdict[str, int] = defaultdict(int)

    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if name.endswith(".txt")]
        if not names:
            raise SystemExit("GeoNames cities500 archive did not contain a text file")
        with archive.open(names[0]) as raw:
            for raw_line in io.TextIOWrapper(raw, encoding="utf-8"):
                columns = raw_line.rstrip("\n").split("\t")
                if len(columns) < 19:
                    continue

                code = columns[8].strip().upper()
                if code not in indexes:
                    continue

                name = columns[1]
                ascii_name = columns[2]
                alternate_names = columns[3]

                add_term(discovery[code], name)
                add_term(discovery[code], ascii_name)
                add_term(attribution[code], name)
                add_term(attribution[code], ascii_name)

                for alias in alternate_names.split(","):
                    add_term(attribution[code], alias)

                geonames_records[code] += 1

    countries_by_term: defaultdict[str, set[str]] = defaultdict(set)
    for code, terms in discovery.items():
        for term in terms:
            normalized = normalize(term)
            if normalized:
                countries_by_term[normalized].add(code)

    total_records = 0
    total_discovery = 0
    total_attribution = 0
    total_ambiguous = 0

    for code, index in indexes.items():
        discovery_terms = sorted(discovery[code], key=lambda v: (normalize(v), v))
        attribution_terms = sorted(attribution[code], key=lambda v: (normalize(v), v))
        ambiguous = sorted(
            normalized
            for normalized in {normalize(term) for term in discovery_terms}
            if normalized and len(countries_by_term[normalized]) > 1
        )

        content_material = json.dumps(
            {
                "attributionTerms": attribution_terms,
                "discoveryTerms": discovery_terms,
                "ambiguousTerms": ambiguous,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        content_hash = hashlib.sha256(content_material).hexdigest()

        index["attributionTerms"] = attribution_terms
        index["discoveryTerms"] = discovery_terms
        index["ambiguousTerms"] = ambiguous
        index["contentSha256"] = content_hash

        source = index.setdefault("source", {})
        source["geonames"] = {
            "name": SOURCE_NAME,
            "url": URL,
            "fetchedAt": fetched_at,
            "lastModified": last_modified,
            "sha256": digest,
            "license": LICENSE,
            "scope": "cities with population > 500 or administrative seats through PPLA4",
        }

        counts = index.setdefault("counts", {})
        counts["geonamesCityRecords"] = geonames_records[code]
        counts["attributionTerms"] = len(attribution_terms)
        counts["discoveryTerms"] = len(discovery_terms)
        counts["ambiguousTerms"] = len(ambiguous)

        total_records += geonames_records[code]
        total_discovery += len(discovery_terms)
        total_attribution += len(attribution_terms)
        total_ambiguous += len(ambiguous)

        path = GEOGRAPHY_DIR / f"{code}.json"
        path.write_text(
            json.dumps(index, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    readme_path = GEOGRAPHY_DIR / "README.md"
    readme = readme_path.read_text(encoding="utf-8") if readme_path.exists() else "# Generated Geography Index\n"
    marker = "## GeoNames enrichment"
    if marker in readme:
        readme = readme.split(marker, 1)[0].rstrip() + "\n\n"

    readme += f"""## GeoNames enrichment

The base country/state/city index is additionally enriched from the official
[GeoNames](https://www.geonames.org/) gazetteer using the global `cities500`
extract.

- Source: {URL}
- Retrieved: `{fetched_at}`
- Last-Modified: `{last_modified or 'not supplied'}`
- Download SHA-256: `{digest}`
- License: **{LICENSE}**
- GeoNames city records merged: **{total_records:,}**
- Combined discovery terms: **{total_discovery:,}**
- Combined attribution terms: **{total_attribution:,}**
- Per-country ambiguous-term memberships: **{total_ambiguous:,}**

GeoNames documents `cities500` as cities with population greater than 500,
plus administrative seats down to PPLA4. The generated index also retains the
base country/state/city database, so the two sources complement each other.

Generated geography data incorporates upstream datasets with different
licenses. Users of the generated geography files should comply with both the
base database ODbL terms and GeoNames CC BY 4.0 attribution requirements.
"""
    readme_path.write_text(readme, encoding="utf-8")
    print(
        f"Merged {total_records:,} GeoNames city rows; "
        f"{total_discovery:,} discovery terms across {len(indexes)} regions."
    )


if __name__ == "__main__":
    main()
