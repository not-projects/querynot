import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const releaseNotes =
  /^docs\/release\/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-notes\.md$/;

/** @param {string} path */
export function documentationOnlyPath(path) {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\0-\x1f\x7f]/.test(path)
  ) {
    return false;
  }
  if (releaseNotes.test(path)) return false;
  return (
    /^[^/]+\.md$/.test(path) ||
    path.startsWith('docs/') ||
    path.startsWith('evidence/') ||
    path === 'traceability/requirements.json' ||
    path === '.github/PULL_REQUEST_TEMPLATE.md' ||
    path.startsWith('.github/ISSUE_TEMPLATE/')
  );
}

/** @param {string[]} paths */
export function requiresFullCi(paths) {
  return (
    paths.length === 0 || paths.some((path) => !documentationOnlyPath(path))
  );
}

function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      head: { type: 'string' }
    },
    strict: true
  });
  if (!values.base || !values.head) {
    throw new Error(
      'usage: node scripts/ci-change-scope.mjs --base <commit> --head <commit>'
    );
  }
  if (
    !/^[a-f0-9]{40}$/.test(values.base) ||
    !/^[a-f0-9]{40}$/.test(values.head)
  ) {
    throw new Error('CI change scope requires full lowercase commit SHAs');
  }

  if (/^0{40}$/.test(values.base)) {
    process.stdout.write('full=true\nreason=new-history\n');
    return;
  }
  const baseExists = spawnSync(
    'git',
    ['cat-file', '-e', `${values.base}^{commit}`],
    { cwd: root }
  );
  if (baseExists.status !== 0) {
    process.stdout.write('full=true\nreason=unavailable-base\n');
    return;
  }
  const diff = spawnSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', values.base, values.head],
    { cwd: root }
  );
  if (diff.status !== 0) {
    throw new Error('could not classify the commit change scope');
  }
  const paths = diff.stdout.toString('utf8').split('\0').filter(Boolean);
  const full = requiresFullCi(paths);
  process.stdout.write(
    `full=${String(full)}\nreason=${full ? 'application-or-release-input' : 'documentation-only'}\n`
  );
  process.stderr.write(
    `classified ${paths.length} changed path${paths.length === 1 ? '' : 's'} as ${full ? 'full CI' : 'documentation-only CI'}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main();
}
