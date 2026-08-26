export type FloatingPanelAlign = 'start' | 'end';

export function floatingPanelPosition(
  root: HTMLElement,
  trigger: HTMLElement,
  panel: HTMLElement,
  align: FloatingPanelAlign
): { left: number; top: number } {
  const shell = root.closest<HTMLElement>('.app-shell');
  const boundary = root.closest<HTMLElement>('[data-action-menu-boundary]');
  const shellBounds = shell?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const boundaryBounds = boundary?.getBoundingClientRect() ?? {
    left: 0,
    right: window.innerWidth,
    top: 0,
    bottom: window.innerHeight
  };
  const triggerBounds = trigger.getBoundingClientRect();
  const scale = shell
    ? Math.max(shell.getBoundingClientRect().width / shell.offsetWidth, 0.01)
    : 1;
  const gutter = 6 * scale;
  const panelWidth = panel.offsetWidth * scale;
  const panelHeight = panel.offsetHeight * scale;
  const spaceBelow = boundaryBounds.bottom - triggerBounds.bottom - gutter;
  const spaceAbove = triggerBounds.top - boundaryBounds.top - gutter;
  const openAbove = panelHeight > spaceBelow && spaceAbove > spaceBelow;
  const preferredLeft =
    align === 'start' ? triggerBounds.left : triggerBounds.right - panelWidth;
  const physicalLeft = Math.min(
    Math.max(preferredLeft, boundaryBounds.left + gutter),
    boundaryBounds.right - panelWidth - gutter
  );
  const preferredTop = openAbove
    ? triggerBounds.top - panelHeight - gutter
    : triggerBounds.bottom + gutter;
  const physicalTop = Math.min(
    Math.max(preferredTop, boundaryBounds.top + gutter),
    boundaryBounds.bottom - panelHeight - gutter
  );
  return {
    left: (physicalLeft - shellBounds.left) / scale,
    top: (physicalTop - shellBounds.top) / scale
  };
}
