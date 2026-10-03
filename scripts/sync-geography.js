import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { COUNTRIES } from '../src/countries.js';
import { projectRoot } from '../src/config.js';
import {
  buildCountryGeographyIndexes,
  downloadGeographyDataset,
  GEOGRAPHY_SOURCE,
} from '../src/geography-source.js';

const root = projectRoot();
const geographyDir = path.join(root, 'geography');

console.log(
  `Downloading ${GEOGRAPHY_SOURCE.name} ${GEOGRAPHY_SOURCE.release} and verifying SHA-256...`,
);
const dataset = await downloadGeographyDataset();
const indexes = buildCountryGeographyIndexes(dataset, COUNTRIES);

if (indexes.size < 240) {
  throw new Error(
    `Geography export produced only ${indexes.size} recognized country indexes; refusing to publish.`,
  );
}

await rm(geographyDir, { recursive: true, force: true });
await mkdir(geographyDir, { recursive: true });

let totalCityRecords = 0;
let totalDiscoveryTerms = 0;

for (const country of COUNTRIES) {
  const index = indexes.get(country.code);
  if (!index) continue;

  totalCityRecords += index.counts.cityRecords;
  totalDiscoveryTerms += index.counts.discoveryTerms;

  await writeFile(
    path.join(geographyDir, `${country.code}.json`),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8',
  );
}

const readme = `# Generated Geography Index

This directory is generated from **${GEOGRAPHY_SOURCE.name}** and is used for country attribution and city/admin discovery planning.

- Source repository: https://github.com/${GEOGRAPHY_SOURCE.repository}
- Pinned release: \`${GEOGRAPHY_SOURCE.release}\`
- Source asset: \`${GEOGRAPHY_SOURCE.asset}\`
- Verified SHA-256: \`${GEOGRAPHY_SOURCE.sha256}\`
- Source database license: **${GEOGRAPHY_SOURCE.license}**
- Countries/territories generated: **${indexes.size}**
- City/town/district records represented: **${totalCityRecords.toLocaleString('en-US')}**
- Unique discovery terms across country files: **${totalDiscoveryTerms.toLocaleString('en-US')}**

The files in this directory are a compact derivative index of the upstream geography database. They are provided under the upstream database's ODbL terms. Project source code outside this generated geography data remains under the MIT License.

Do not edit these JSON files manually. Run \`npm run sync:geography\` instead.
`;

await writeFile(path.join(geographyDir, 'README.md'), readme, 'utf8');

console.log(
  `Generated ${indexes.size} geography indexes from ${totalCityRecords.toLocaleString('en-US')} city/town/district records.`,
);
