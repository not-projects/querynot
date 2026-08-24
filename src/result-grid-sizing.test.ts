import { describe, expect, it } from 'vitest';

import {
  MAX_AUTO_RESULT_COLUMN_WIDTH,
  MIN_RESULT_COLUMN_WIDTH,
  autoResultColumnWidth
} from './lib/result-grid-sizing';
import type { ResultRowView, TaggedValueView } from './lib/generated/contracts';

const value = (text: string): TaggedValueView => ({
  value_type: 'text',
  text,
  boolean: null,
  bytes_base64: null,
  timezone_or_offset: null
});

const rows = (...texts: string[]): ResultRowView[] =>
  texts.map((text) => ({ values: [value(text)] }));

describe('result grid automatic column sizing', () => {
  it('compacts short identifiers instead of assigning the old full width', () => {
    expect(
      autoResultColumnWidth(
        { name: 'id', declared_type: 'INTEGER', nullable: false },
        rows('1', '42'),
        0,
        13,
        'monospace'
      )
    ).toBe(MIN_RESULT_COLUMN_WIDTH);
  });

  it('grows for ordinary values and caps long values at the established width', () => {
    const ordinary = autoResultColumnWidth(
      { name: 'display_name', declared_type: 'TEXT', nullable: true },
      rows('Ada Lovelace'),
      0,
      13,
      'monospace'
    );
    const long = autoResultColumnWidth(
      { name: 'payload', declared_type: 'TEXT', nullable: true },
      rows('x'.repeat(1_000)),
      0,
      13,
      'monospace'
    );

    expect(ordinary).toBeGreaterThan(MIN_RESULT_COLUMN_WIDTH);
    expect(ordinary).toBeLessThan(MAX_AUTO_RESULT_COLUMN_WIDTH);
    expect(long).toBe(MAX_AUTO_RESULT_COLUMN_WIDTH);
  });

  it('accounts for the selected table font size and wide characters', () => {
    const small = autoResultColumnWidth(
      { name: 'name', declared_type: 'TEXT', nullable: true },
      rows('Журнал'),
      0,
      10,
      'system'
    );
    const large = autoResultColumnWidth(
      { name: 'name', declared_type: 'TEXT', nullable: true },
      rows('Журнал'),
      0,
      20,
      'monospace'
    );
    const wide = autoResultColumnWidth(
      { name: 'name', declared_type: 'TEXT', nullable: true },
      rows('数据字段'),
      0,
      20,
      'monospace'
    );

    expect(large).toBeGreaterThan(small);
    expect(wide).toBeGreaterThanOrEqual(large);
  });
});
