# ADR 0014: Connection-scoped tabs and workbench History drawer

- Status: Accepted
- Date: 2026-08-21
- Scope: Included in the `0.1.4` release source after `0.1.3`
- Supersedes: Only the sidebar-grouped presentation in [ADR 0013](0013-stable-editor-and-connection-grouped-tabs.md)

## Context

ADR 0013 correctly kept the persisted workspace flat and made every connected query or table tab own an isolated native session. Its sidebar-grouped presentation, however, combined profile controls and every child tab in one narrow column. Long connection labels and actions became difficult to read, while the active query context lost the familiar horizontal tab workflow.

History shared that constrained sidebar with connections and schema metadata. The result workbench also relied on implicit grid placement even though its optional error row, editor, separator, and results pane form a strict vertical sequence. A populated result could therefore be laid out incorrectly even when result streaming and virtualization had succeeded.

## Decision

### Connections and scoped tabs

The left sidebar shows saved profiles as compact two-line rows plus one Offline row. A profile row uses the available width for its name and endpoint, exposes status and the current Connect, Disconnect, or Cancel action directly, and keeps Test, Edit, Duplicate, and Delete in an overflow menu. Query and table children are not rendered in the sidebar.

The selected profile, or Offline, owns the horizontal tab strip above the editor. The strip receives an already filtered array and preserves dirty, pinned, table-data, session-opening/error, close, rename, duplicate, pin, and group-local move behavior. `Ctrl+Tab` cycles only that visible group; Arrow keys, Home, and End navigate the strip. Activation from History, schema actions, or another programmatic route selects the tab's owning profile automatically.

The most recently active tab identifier for each profile and Offline is ephemeral UI state. Selecting a group restores that tab when it is still available, otherwise selects the group's first tab, and creates a query only when the group is empty. The persisted `WorkspaceView.tabs` array, ordering, active tab, profile bindings, and panel sizes remain unchanged.

### History drawer

History moves to a right-edge overlay drawer inside the workbench, opened by an always-available header action. The drawer retains local search, reopen, individual deletion, clear confirmation, warnings, metadata, and privacy guidance. Opening loads entries and focuses search. Close, Escape, and backdrop click dismiss it and return focus to the trigger; reopening an entry closes it, activates the entry's connection-scoped tab when possible, focuses the editor, and never executes SQL.

The drawer overlays the main pane and does not participate in workbench column sizing. Its styling uses QueryNot tokens and does not copy MongoDB Compass assets, colors, or branding.

### Result tracks

The main workbench defines explicit grid rows in order for connection context, scoped tabs, an optional tab-session error, the editor or table pane, the separator, and results. The existing persisted 20–70% split, pointer and keyboard resizing, selected multiple-result set, zero-row columns, virtualized row grid, error display, and acknowledged-stream backpressure contracts are unchanged.

## Consequences

- ADR 0013's stable CodeMirror attachment, export disclosure, flat workspace, lazy isolated tab sessions, pending-operation blockers, and profile-level Connect/Disconnect decisions remain in force.
- No Tauri command, Rust adapter, generated contract, database schema, credential boundary, or persisted `WorkspaceView` shape changes.
- Connection navigation stays readable without duplicating tab controls, and active query contexts regain a familiar horizontal strip.
- History can use the workbench height without shrinking the editor or results pane.
- Result content begins deterministically below the separator regardless of optional state rows.
- Native Windows interaction still requires physical review for dark-theme rendering, pointer splitter input, tab keyboard navigation, drawer focus, and 100%/150% scaling before those observations are claimed.

## Validation

Svelte integration tests retain lazy-open, Retry, request deduplication, immediate new-child sessions, disconnect, close, transaction, and pending-operation safeguards while asserting group-local restoration and `Ctrl+Tab`. The populated Chromium fixture includes two profiles, Offline drafts, long labels, multiple scoped tabs, one retained row, and local History. It checks readable connection controls, connection-scoped tabs, visible result heading/header/first row, persisted 20/35/70% split geometry, non-resizing History overlay and focus return, 720–2048px layouts, and 150% app scaling without page overflow.
