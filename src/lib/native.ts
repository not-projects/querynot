import { invoke } from '@tauri-apps/api/core';

import type { QueryNotCommands } from './generated/contracts';

export function hasNativeRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in
      (window as unknown as Window & Record<string, unknown>)
  );
}

export async function invokeCommand<K extends keyof QueryNotCommands>(
  command: K,
  request: QueryNotCommands[K]['request']
): Promise<QueryNotCommands[K]['response']> {
  const argumentsValue = request === null ? {} : { request };
  return invoke<QueryNotCommands[K]['response']>(command, argumentsValue);
}
