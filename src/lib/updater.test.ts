import { describe, expect, it } from 'vitest';

import { formatUpdateBytes, updateProgressPercent } from './updater.svelte';

describe('signed updater presentation helpers', () => {
  it('bounds known-length download progress', () => {
    expect(
      updateProgressPercent({
        downloaded_bytes: 25,
        content_length: 100,
        finished: false
      })
    ).toBe(25);
    expect(
      updateProgressPercent({
        downloaded_bytes: 125,
        content_length: 100,
        finished: true
      })
    ).toBe(100);
  });

  it('keeps unknown-length progress indeterminate and formats byte counts', () => {
    expect(
      updateProgressPercent({
        downloaded_bytes: 1024,
        content_length: null,
        finished: false
      })
    ).toBeNull();
    expect(formatUpdateBytes(512)).toBe('512 B');
    expect(formatUpdateBytes(2048)).toBe('2.0 KiB');
    expect(formatUpdateBytes(2 * 1024 * 1024)).toBe('2.0 MiB');
  });
});
