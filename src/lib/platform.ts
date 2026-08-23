export function isMacPlatform(platform?: string): boolean {
  const detected =
    platform ??
    (typeof navigator === 'undefined'
      ? ''
      : navigator.platform || navigator.userAgent);
  return /mac|iphone|ipad|ipod/i.test(detected);
}

export function primaryModifierPressed(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>,
  mac = isMacPlatform()
): boolean {
  return mac ? event.metaKey : event.ctrlKey;
}

export function primaryShortcutLabel(mac = isMacPlatform()): 'Cmd' | 'Ctrl' {
  return mac ? 'Cmd' : 'Ctrl';
}

export function primaryAriaModifier(mac = isMacPlatform()): 'Meta' | 'Control' {
  return mac ? 'Meta' : 'Control';
}
