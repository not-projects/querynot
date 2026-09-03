import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { mount } from 'svelte';

import App from '../../src/App.svelte';
import '../../src/styles/app.css';

const settings = {
  theme: 'dark',
  ui_scale_percent: 100,
  editor_word_wrap: false,
  formatter_uppercase_keywords: true,
  formatter_indent_spaces: 2,
  connection_timeout_seconds: 15,
  result_tranche_rows: 10_000,
  table_page_rows: 200,
  table_font_family: 'monospace',
  table_font_size_px: 13,
  plan_hotspot_estimates_enabled: false,
  history_enabled: true,
  history_retention_days: 90,
  session_restoration_enabled: true,
  automatic_reconnect_default: false,
  operational_log_enabled: true,
  operational_log_max_bytes: 5 * 1024 * 1024,
  operational_log_retention_days: 7
};

const workspace = {
  tabs: [
    {
      id: 'browser-editor-tab',
      title: 'Focus regression',
      kind: 'query',
      pinned: false,
      profile_id: null,
      profile_label: null,
      context_label: null,
      sql: '',
      dirty: false,
      position: 0,
      source_file_grant_id: null,
      table_namespace: null,
      table_name: null,
      reconnectable: false
    }
  ],
  active_tab_id: 'browser-editor-tab',
  panel_sizes: {
    explorer_percent: 22,
    results_percent: 35,
    sidebar_connections_percent: 50
  }
};

mockWindows('main');
mockIPC(
  (command) => {
    switch (command) {
      case 'bootstrap_workspace':
        return {
          contract_version: 1,
          phase: 'phase_4_productivity_and_safe_data_editing',
          store_state: 'ready',
          store_message: null,
          profiles: [],
          settings,
          workspace
        };
      case 'take_pending_sql_files':
        return { files: [] };
      case 'check_for_updates':
        return { configured: false, update: null };
      case 'save_workspace':
        return { saved: true, message: 'Saved in memory.' };
      default:
        return null;
    }
  },
  { shouldMockEvents: true }
);

const target = document.getElementById('app');
if (!target) throw new Error('Editor focus fixture root is missing');
mount(App, { target });
