import { describe, expect, it } from 'vitest';

import type { StagedTableMutation } from './lib/table-staging';
import {
  localMutationErrors,
  nativeMutationOperations
} from './lib/table-staging';

const staged: StagedTableMutation[] = [
  {
    kind: 'update',
    original: [
      {
        value_type: 'signed_integer',
        text: '7',
        boolean: null,
        bytes_base64: null,
        timezone_or_offset: null
      }
    ],
    cells: [
      {
        column: 'quantity',
        mode: 'value',
        value: null,
        raw_input: 'not-a-number',
        local_error: 'quantity requires an integer.'
      }
    ]
  }
];

describe('local table mutation staging', () => {
  it('retains invalid input and exposes a blocking local error', () => {
    expect(localMutationErrors(staged)).toEqual([
      'quantity: quantity requires an integer.'
    ]);
    expect(staged[0].cells[0].raw_input).toBe('not-a-number');
  });

  it('strips UI-only input and validation state at the native boundary', () => {
    expect(nativeMutationOperations(staged)).toEqual([
      {
        kind: 'update',
        original: staged[0].original,
        cells: [
          {
            column: 'quantity',
            mode: 'value',
            value: null
          }
        ]
      }
    ]);
  });
});
