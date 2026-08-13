import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const result = spawnSync(
  'cargo',
  [
    'run',
    '--locked',
    '--release',
    '--package',
    'querynot-core',
    '--example',
    'phase2_benchmark'
  ],
  {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit']
  }
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Phase 2 benchmark failed with status ${result.status}`);
}
const report = JSON.parse(result.stdout.trim());
if (
  report.sample_policy?.measured_independent_runs !== 30 ||
  report.first_driver_stream_to_first_1000_row_batch_ms?.status !== 'pass'
) {
  throw new Error(
    'Phase 2 benchmark output does not satisfy its checked contract'
  );
}
writeSync(1, `${JSON.stringify(report)}\n`);
