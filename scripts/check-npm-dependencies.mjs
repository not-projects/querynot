import { readFile } from 'node:fs/promises';

const allowedLicenses = new Set([
  'Apache-2.0',
  'Apache-2.0 OR MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0'
]);

const lockfile = JSON.parse(
  await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')
);
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);
const violations = [];
const licenseCounts = new Map();

for (const dependencyKind of ['dependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(
    packageJson[dependencyKind] ?? {}
  )) {
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      violations.push(
        `${dependencyKind}.${name} is not pinned to an exact version: ${version}`
      );
    }
  }
}

for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
  if (path === '') continue;

  if (!entry.license) {
    violations.push(`${path} has no declared license in package-lock.json`);
  } else if (!allowedLicenses.has(entry.license)) {
    violations.push(
      `${path} uses unreviewed license expression ${entry.license}`
    );
  } else {
    licenseCounts.set(
      entry.license,
      (licenseCounts.get(entry.license) ?? 0) + 1
    );
  }

  if (
    entry.resolved &&
    !entry.resolved.startsWith('https://registry.npmjs.org/')
  ) {
    violations.push(`${path} uses an unapproved package source`);
  }

  if (entry.resolved && !entry.integrity) {
    violations.push(
      `${path} has a resolved archive without an integrity digest`
    );
  }
}

if (violations.length > 0) {
  console.error(
    'npm dependency policy failed:\n' +
      violations.map((item) => `- ${item}`).join('\n')
  );
  process.exitCode = 1;
} else {
  const reviewed = [...licenseCounts.values()].reduce(
    (sum, count) => sum + count,
    0
  );
  const summary = [...licenseCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, count]) => `${license}=${count}`)
    .join(', ');
  console.log(`npm dependency policy passed: ${reviewed} packages; ${summary}`);
}
