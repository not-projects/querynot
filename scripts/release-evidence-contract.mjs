import { basename } from 'node:path';

export const osMatrix = ['windows-11-x64'];

export const osArchitectures = new Map([['windows-11-x64', 'x86_64']]);

export const osFamilies = new Map([['windows', ['windows-11-x64']]]);

export const expectedArtifacts = new Map([['windows-nsis-x64', 'nsis']]);

export const osArtifacts = new Map([['windows-11-x64', ['windows-nsis-x64']]]);

export const coreJourneyChecks = [
  'first_run_shell_offline',
  'sqlite_profile_schema_context',
  'query_targets_values_results_cancellation',
  'copy_sort_filter_load_more_export',
  'table_browse_edit_conflict_rollback',
  'destructive_confirmation_invalidation',
  'history_drafts_files_tabs_close_decisions',
  'connection_loss_reload_relaunch_restore',
  'uninstall_data_handling'
];

export const familyNetworkChecks = [
  'profile_vault_and_session_credentials',
  'tls_modes',
  'mariadb_identity',
  'mysql_legacy_indicator',
  'simultaneous_connections_and_tabs',
  'profile_vault_cache_deletion'
];

export const accessibilityChecks = [
  'wcag_2_2_aa',
  'keyboard_all_functions',
  'visible_and_restored_focus',
  'tablist_tree_dialog_patterns',
  'native_dialogs_and_close_blockers',
  'not_color_only',
  'reduced_motion',
  'bounded_editor_and_grid_scrolling',
  'no_page_horizontal_scroll'
];

export const performanceMeasurements = new Map([
  ['cold_launch_p95_ms', { aggregation: 'nearest_rank_p95', limit: 3000 }],
  ['local_response_p95_ms', { aggregation: 'nearest_rank_p95', limit: 100 }],
  [
    'first_visible_batch_p95_ms',
    { aggregation: 'nearest_rank_p95', limit: 100 }
  ],
  ['editor_typing_fps_p95', { aggregation: 'nearest_rank_p95', minimum: 55 }],
  ['result_scroll_fps_p95', { aggregation: 'nearest_rank_p95', minimum: 55 }],
  ['idle_resident_memory_mib', { aggregation: 'maximum', limit: 250 }],
  ['cleanup_ratio_after_10s', { aggregation: 'maximum', limit: 1.15 }]
]);

/** @param {number[]} samples */
export function nearestRankP95(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

/**
 * @param {number[]} samples
 * @param {'nearest_rank_p95'|'maximum'} aggregation
 */
export function aggregateSamples(samples, aggregation) {
  if (!Array.isArray(samples) || samples.length === 0) return Number.NaN;
  if (aggregation === 'nearest_rank_p95') return nearestRankP95(samples);
  if (aggregation === 'maximum') return Math.max(...samples);
  return Number.NaN;
}

/** @param {unknown} name */
export function safeArtifactName(name) {
  return (
    typeof name === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name) &&
    basename(name) === name &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(name)
  );
}

/**
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseChecksumManifest(text) {
  if (typeof text !== 'string')
    throw new Error('checksum manifest is not text');
  const lines = text.trimEnd().split('\n');
  if (lines.length === 0 || lines[0] === '') {
    throw new Error('checksum manifest is empty');
  }
  const records = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    if (!match) throw new Error('checksum manifest contains an invalid line');
    const [, sha256, name] = match;
    if (!safeArtifactName(name)) {
      throw new Error('checksum manifest contains an unsafe name');
    }
    if (records.has(name)) {
      throw new Error(`checksum manifest repeats ${name}`);
    }
    records.set(name, sha256);
  }
  return records;
}
