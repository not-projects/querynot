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
    .map((line) => line.slice(3));
}
