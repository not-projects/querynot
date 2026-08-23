import { describe, expect, it } from 'vitest';

import {
  isMacPlatform,
  primaryAriaModifier,
  primaryModifierPressed,
  primaryShortcutLabel
} from './platform';

describe('desktop platform shortcuts', () => {
  it('uses Command on macOS and Control on Windows and Linux', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform('Linux x86_64')).toBe(false);
    expect(primaryShortcutLabel(true)).toBe('Cmd');
    expect(primaryAriaModifier(true)).toBe('Meta');
    expect(primaryShortcutLabel(false)).toBe('Ctrl');
    expect(primaryAriaModifier(false)).toBe('Control');
  });

  it('routes only the platform primary modifier', () => {
    expect(
      primaryModifierPressed({ ctrlKey: false, metaKey: true }, true)
    ).toBe(true);
    expect(
      primaryModifierPressed({ ctrlKey: true, metaKey: false }, true)
    ).toBe(false);
    expect(
      primaryModifierPressed({ ctrlKey: true, metaKey: false }, false)
    ).toBe(true);
    expect(
      primaryModifierPressed({ ctrlKey: false, metaKey: true }, false)
    ).toBe(false);
  });
});
