import type {
  MutationCellView,
  TableMutationView
} from './generated/contracts';

export type StagedMutationCell = MutationCellView & {
  raw_input: string | null;
  local_error: string | null;
};

export type StagedTableMutation = Omit<TableMutationView, 'cells'> & {
  cells: StagedMutationCell[];
};

export function localMutationErrors(
  operations: StagedTableMutation[]
): string[] {
  return operations.flatMap((operation) =>
    operation.cells.flatMap((cell) =>
      cell.local_error ? [`${cell.column}: ${cell.local_error}`] : []
    )
  );
}

export function nativeMutationOperations(
  operations: StagedTableMutation[]
): TableMutationView[] {
  return operations.map((operation) => ({
    kind: operation.kind,
    original: operation.original,
    cells: operation.cells.map((cell) => ({
      column: cell.column,
      mode: cell.mode,
      value: cell.value
    }))
  }));
}
