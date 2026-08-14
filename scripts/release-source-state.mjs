/**
 * Parse `git status --porcelain` without trimming its meaningful leading status
 * column. Git quotes unusual paths, which remain conservative non-allowlisted
 * values; release evidence paths use the repository's plain ASCII names.
 *
 * @param {string} stdout
 * @returns {string[]}
 */
export function porcelainPaths(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).replace(/\r$/, '').replaceAll('\\', '/'));
}

const evidencePrefix = 'evidence/phase-5/';
const generatedPrefixes = [
  '.tmp/',
  'artifacts/',
  'dist/',
  'src-tauri/gen/',
  'src-tauri/target/',
  'target/'
];

/**
 * Return repository changes which cannot be attributed to retained Phase 5
 * evidence or, after an independently clean pre-build check, known generated
 * release output roots.
 *
 * @param {string} stdout
 * @param {{ allowGeneratedOutputs?: boolean }} [options]
 * @returns {string[]}
 */
export function disallowedReleaseChanges(
  stdout,
  { allowGeneratedOutputs = false } = {}
) {
  return porcelainPaths(stdout).filter((path) => {
    if (path.startsWith(evidencePrefix)) return false;
    return !(
      allowGeneratedOutputs &&
      generatedPrefixes.some((prefix) => path.startsWith(prefix))
    );
  });
}

/**
 * Keep CI diagnostics useful without reflecting control characters or an
 * unbounded path list into logs.
 *
 * @param {string[]} paths
 * @returns {string}
 */
export function releaseChangeSummary(paths) {
  const safe = paths
    .slice(0, 8)
    .map((path) =>
      /^[A-Za-z0-9._/@+ -]+$/.test(path)
        ? path
        : '[path contains unsupported characters]'
    );
  if (paths.length > safe.length) {
    safe.push(`[and ${paths.length - safe.length} more]`);
  }
  return safe.join(', ');
}
