<script lang="ts">
  import { basicSetup } from 'codemirror';
  import { syntaxTree } from '@codemirror/language';
  import { MySQL, SQLite, sql } from '@codemirror/lang-sql';
  import { linter, type Diagnostic } from '@codemirror/lint';
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';
  import type { Attachment } from 'svelte/attachments';

  export interface EditorRunRequest {
    selectionStart: number | null;
    selectionEnd: number | null;
    cursor: number;
    runAll: boolean;
  }

  export interface SqlEditorApi {
    focus(): void;
    selection(): { start: number; end: number; cursor: number };
  }

  interface Props {
    value: string;
    wordWrap: boolean;
    completionSchema: Record<string, readonly string[]>;
    dialect: string;
    disabled?: boolean;
    onchange: (value: string) => void;
    onrun: (request: EditorRunRequest) => void;
    oncancel: () => void;
    onformat: () => void;
    onready?: (api: SqlEditorApi | null) => void;
  }

  let {
    value,
    wordWrap,
    completionSchema,
    dialect,
    disabled = false,
    onchange,
    onrun,
    oncancel,
    onformat,
    onready
  }: Props = $props();

  let view: EditorView | null = null;
  let applyingExternal = false;
  const wrapCompartment = new Compartment();
  const languageCompartment = new Compartment();
  const editableCompartment = new Compartment();

  function run(runAll: boolean) {
    if (!view || disabled) return false;
    const selection = view.state.selection.main;
    onrun({
      selectionStart: selection.empty ? null : selection.from,
      selectionEnd: selection.empty ? null : selection.to,
      cursor: selection.head,
      runAll
    });
    return true;
  }

  const parseDiagnostics = linter((editor) => {
    const diagnostics: Diagnostic[] = [];
    syntaxTree(editor.state).iterate({
      enter(node) {
        if (node.type.isError) {
          diagnostics.push({
            from: node.from,
            to: Math.max(node.to, node.from + 1),
            severity: 'warning',
            message:
              'The selected SQL dialect could not classify this range. Execution may require an explicit selection.'
          });
        }
      }
    });
    return diagnostics;
  });

  const mountEditor: Attachment<HTMLElement> = (element) => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        languageCompartment.of(
          sql({
            dialect: dialect === 'mysql' ? MySQL : SQLite,
            schema: completionSchema
          })
        ),
        wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
        editableCompartment.of(EditorView.editable.of(!disabled)),
        parseDiagnostics,
        keymap.of([
          { key: 'Mod-Enter', run: () => run(false) },
          { key: 'Mod-Shift-Enter', run: () => run(true) },
          {
            key: 'Mod-.',
            run: () => {
              oncancel();
              return true;
            }
          },
          {
            key: 'Shift-Alt-f',
            run: () => {
              onformat();
              return true;
            }
          }
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal) {
            onchange(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            color: 'var(--text)',
            backgroundColor: 'var(--surface-raised)'
          },
          '.cm-content': {
            caretColor: 'var(--accent)',
            fontFamily:
              "'IBM Plex Mono', 'Cascadia Code', ui-monospace, monospace",
            fontSize: '0.9rem',
            lineHeight: '1.6'
          },
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: 'var(--accent)'
          },
          '.cm-gutters': {
            color: 'var(--muted)',
            backgroundColor: 'var(--surface)',
            borderRightColor: 'var(--divider)'
          },
          '.cm-activeLine, .cm-activeLineGutter': {
            backgroundColor:
              'color-mix(in srgb, var(--accent) 12%, transparent)'
          },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
            backgroundColor:
              'color-mix(in srgb, var(--accent) 28%, transparent)'
          },
          '&.cm-focused': { outline: '2px solid var(--accent)' }
        })
      ]
    });
    view = new EditorView({ state, parent: element });
    onready?.({
      focus: () => view?.focus(),
      selection: () => {
        const selection = view?.state.selection.main;
        return {
          start: selection?.from ?? 0,
          end: selection?.to ?? 0,
          cursor: selection?.head ?? 0
        };
      }
    });
    return () => {
      onready?.(null);
      view?.destroy();
      view = null;
    };
  };

  $effect(() => {
    if (!view || view.state.doc.toString() === value) return;
    applyingExternal = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    });
    applyingExternal = false;
  });

  $effect(() => {
    view?.dispatch({
      effects: wrapCompartment.reconfigure(
        wordWrap ? EditorView.lineWrapping : []
      )
    });
  });

  $effect(() => {
    view?.dispatch({
      effects: languageCompartment.reconfigure(
        sql({
          dialect: dialect === 'mysql' ? MySQL : SQLite,
          schema: completionSchema
        })
      )
    });
  });

  $effect(() => {
    view?.dispatch({
      effects: editableCompartment.reconfigure(
        EditorView.editable.of(!disabled)
      )
    });
  });
</script>

<div
  class="sql-editor-host"
  aria-label={`${dialect === 'mysql' ? 'MySQL-family' : 'SQLite'} SQL editor`}
  aria-keyshortcuts="Control+Enter Meta+Enter Control+Shift+Enter Meta+Shift+Enter Control+Period Meta+Period"
  {@attach mountEditor}
></div>

<style>
  .sql-editor-host {
    min-height: 15rem;
    height: 100%;
    overflow: hidden;
  }

  .sql-editor-host :global(.cm-editor) {
    min-height: 15rem;
  }
</style>
