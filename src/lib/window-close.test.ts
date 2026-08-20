import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  firstWindowCloseBlocker,
  type WindowCloseState
} from './window-close';

const cleanWindow: WindowCloseState = {
  activeExecutionTabId: null,
  unresolvedTransactionTabId: null,
  stagedTableTabId: null,
  connectionOperationTabId: null,
  connectionOperationCount: 0,
  busy: false,
  unrecoverableDirtyTabId: null
};

describe('silent native window close', () => {
  it('closes a clean window without asking for a redundant decision', () => {
    expect(firstWindowCloseBlocker(cleanWindow)).toBeNull();
  });

  it.each([
    ['activeExecutionTabId', 'execution'],
    ['unresolvedTransactionTabId', 'transaction'],
    ['stagedTableTabId', 'staged-changes'],
    ['unrecoverableDirtyTabId', 'recovery-disabled']
  ] as const)('focuses the affected tab for %s', (field, kind) => {
    expect(
      firstWindowCloseBlocker({ ...cleanWindow, [field]: 'tab-1' })
    ).toMatchObject({ kind, tabId: 'tab-1' });
  });

  it('blocks connection setup without treating clean sessions as dirty work', () => {
    expect(
      firstWindowCloseBlocker({
        ...cleanWindow,
        connectionOperationCount: 1,
        connectionOperationTabId: 'tab-2'
      })
    ).toMatchObject({ kind: 'connection', tabId: 'tab-2' });
  });

  it('grants only the explicit destroy command used after safety checks', () => {
    const capability = JSON.parse(
      readFileSync('src-tauri/capabilities/main.json', 'utf8')
    ) as { permissions: string[] };

    expect(capability.permissions).toContain('core:window:allow-destroy');
    expect(capability.permissions).not.toContain('core:window:default');
  });
});
