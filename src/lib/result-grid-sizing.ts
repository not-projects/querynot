import type {
  ResultColumnView,
  ResultRowView,
  TaggedValueView
} from './generated/contracts';

export const MIN_RESULT_COLUMN_WIDTH = 64;
export const MAX_AUTO_RESULT_COLUMN_WIDTH = 180;

export function autoResultColumnWidth(
  column: ResultColumnView,
  rows: ResultRowView[],
  columnIndex: number,
  fontSizePx: number,
  fontFamily: string
): number {
  let units = displayUnits(column.name);
  for (const row of rows) {
    units = Math.max(units, valueDisplayUnits(row.values[columnIndex]));
    if (units >= 32) return MAX_AUTO_RESULT_COLUMN_WIDTH;
  }
  const characterWidth = fontSizePx * (fontFamily === 'system' ? 0.56 : 0.62);
  return Math.min(
    MAX_AUTO_RESULT_COLUMN_WIDTH,
    Math.max(MIN_RESULT_COLUMN_WIDTH, Math.ceil(units * characterWidth + 28))
  );
}

function valueDisplayUnits(value: TaggedValueView | undefined): number {
  if (!value || value.value_type === 'null') return 2;
  if (value.value_type === 'boolean') return value.boolean ? 4 : 5;
  if (value.value_type === 'bytes') {
    const base64Length = value.bytes_base64?.length ?? 0;
    return Math.min(32, 2 + Math.ceil(base64Length / 4) * 6);
  }
  return displayUnits(value.text ?? '');
}

function displayUnits(value: string): number {
  if (value.length > 64) return 32;
  let lineUnits = 0;
  let maximum = 0;
  for (const character of value) {
    if (character === '\n' || character === '\r') {
      maximum = Math.max(maximum, lineUnits);
      lineUnits = 0;
      continue;
    }
    lineUnits += isWideCharacter(character.codePointAt(0) ?? 0) ? 2 : 1;
    if (lineUnits >= 32) return 32;
  }
  return Math.max(maximum, lineUnits);
}

function isWideCharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  );
}
