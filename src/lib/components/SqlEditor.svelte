<script lang="ts">
  import { basicSetup } from 'codemirror';
  import {
    acceptCompletion,
    autocompletion,
    closeCompletion,
    moveCompletionSelection,
    startCompletion
  } from '@codemirror/autocomplete';
  import { indentWithTab, insertNewlineAndIndent } from '@codemirror/commands';
  import { syntaxTree } from '@codemirror/language';
  import {
    MariaSQL,
    MySQL,
    SQLite,
    keywordCompletionSource,
    schemaCompletionSource,
    sql
  } from '@codemirror/lang-sql';
  import { linter, type Diagnostic } from '@codemirror/lint';
  import { Compartment, EditorState, Prec } from '@codemirror/state';
  import { EditorView, keymap, tooltips } from '@codemirror/view';
  import { openSearchPanel } from '@codemirror/search';
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { isMacPlatform, primaryAriaModifier } from '../platform';
  import {
    relationCompletionSource,
    sqlContextCompletionSource,
    type SqlCompletionTable,
    type SqlCompletionTableIdentity,
    type SqlCompletionTableRequest
  } from '../sql-completion';

  export interface EditorRunRequest {
    selectionStart: number | null;
    selectionEnd: number | null;
    cursor: number;
    runAll: boolean;
  }

  export interface SqlEditorApi {
    focus(): void;
    openSearch(): void;
    selection(): { start: number; end: number; cursor: number };
  }

  interface Props {
    value: string;
    wordWrap: boolean;
    completionSchema: Record<string, readonly string[]>;
    completionTables: readonly SqlCompletionTable[];
    selectedCompletionTable: SqlCompletionTableIdentity | null;
    loadCompletionTables: (
      tables: readonly SqlCompletionTableRequest[]
    ) => Promise<readonly SqlCompletionTable[]>;
    dialect: string;
    engine: string;
    exactVersion: string;
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
    completionTables,
    selectedCompletionTable,
    loadCompletionTables,
    dialect,
    engine,
    exactVersion,
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
  const macPrimaryShortcuts = isMacPlatform();
  const editorPrimaryModifier = macPrimaryShortcuts ? 'Cmd' : 'Ctrl';
  const ariaPrimaryModifier = primaryAriaModifier(macPrimaryShortcuts);

  function languageExtensions() {
    const sqlDialect =
      dialect === 'mysql'
        ? engine.toLocaleLowerCase().includes('mariadb')
          ? MariaSQL
          : MySQL
        : SQLite;
    const config = { dialect: sqlDialect, schema: completionSchema };
    const contextualCompletion = sqlContextCompletionSource({
      dialect,
      engine,
      exactVersion,
      tables: completionTables,
      selectedTable: selectedCompletionTable,
      loadTableColumns: loadCompletionTables
    });
    return [
      sql(config),
      autocompletion({
        defaultKeymap: false,
        interactionDelay: 0,
        override: [
          contextualCompletion,
          relationCompletionSource(schemaCompletionSource(config)),
          keywordCompletionSource(sqlDialect)
        ]
      })
    ];
  }

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

  const mountEditor: Attachment<HTMLElement> = (element) =>
    untrack(() => {
      const tooltipParent =
        element.closest<HTMLElement>('.app-shell') ??
        element.ownerDocument.body;
      const state = EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          tooltips({ parent: tooltipParent }),
          languageCompartment.of(languageExtensions()),
          wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
          editableCompartment.of(EditorView.editable.of(!disabled)),
          parseDiagnostics,
          Prec.highest(
            keymap.of([
              {
                key: `${editorPrimaryModifier}-Enter`,
                run: () => run(false)
              },
              {
                key: `${editorPrimaryModifier}-Shift-Enter`,
                run: () => run(true)
              },
              {
                key: `${editorPrimaryModifier}-.`,
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
              },
              {
                key: 'Enter',
                run: (editor) => {
                  closeCompletion(editor);
                  return insertNewlineAndIndent(editor);
                }
              },
              { key: 'Ctrl-Space', run: startCompletion },
              { key: 'Escape', run: closeCompletion },
              {
                key: 'ArrowDown',
                run: moveCompletionSelection(true)
              },
              {
                key: 'ArrowUp',
                run: moveCompletionSelection(false)
              },
              {
                key: 'PageDown',
                run: moveCompletionSelection(true, 'page')
              },
              {
                key: 'PageUp',
                run: moveCompletionSelection(false, 'page')
              },
              { key: 'Tab', run: acceptCompletion },
              indentWithTab
            ])
          ),
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
            '.cm-tooltip': {
              color: 'var(--text)',
              border: '1px solid var(--divider)',
              backgroundColor: 'var(--surface-raised)',
              boxShadow: 'var(--shadow)'
            },
            '.cm-tooltip-autocomplete > ul > li': {
              padding: '0.3rem 0.5rem',
              color: 'var(--text)',
              backgroundColor: 'transparent'
            },
            '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
              color: 'var(--accent-text)',
              backgroundColor: 'var(--accent)'
            },
            '.cm-completionIcon, .cm-completionDetail': {
              color: 'var(--muted)',
              opacity: '1'
            },
            '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionIcon, .cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail':
              {
                color: 'var(--accent-text)'
              },
            '.cm-completionMatchedText': {
              color: 'inherit',
              fontWeight: '750',
              textDecorationColor: 'var(--accent-strong)'
            },
            '&.cm-focused': { outline: '2px solid var(--accent)' }
          })
        ]
      });
      view = new EditorView({ state, parent: element });
      onready?.({
        focus: () => view?.focus(),
        openSearch: () => {
          if (view) openSearchPanel(view);
        },
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
    });

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
      effects: languageCompartment.reconfigure(languageExtensions())
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
  aria-keyshortcuts={`Tab ArrowDown ArrowUp PageDown PageUp Control+Space ${ariaPrimaryModifier}+Enter ${ariaPrimaryModifier}+Shift+Enter ${ariaPrimaryModifier}+Period`}
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
