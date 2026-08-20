# ADR 0013: Stable SQL editing and connection-grouped tabs

- Status: Accepted
- Date: 2026-08-20
- Scope: Released in `0.1.3`

## Context

The SQL editor was mounted through a Svelte attachment whose one-time CodeMirror construction synchronously read reactive component props. Svelte therefore treated normal `value` updates as attachment dependencies, ran the teardown after every character, destroyed the editor view, and mounted another one. The outer host element survived, which hid the remount from shallow DOM checks, but the CodeMirror node and editor focus did not.

The workbench also presented every query and table tab in one horizontal strip even though connections are the primary navigation boundary. Users had to connect tabs explicitly after connecting a profile, the global strip did not communicate session ownership well, and the result pane displayed CSV safety guidance whenever rows existed instead of when export was being configured.

The native boundary already has the required ownership model: `connect_profile` creates the profile metadata session, while `open_tab_session` creates a separate adapter session for one profile/tab pair. Workspace persistence is intentionally flat and already stores profile bindings, positions, the active tab, and panel sizes.

## Decision

### Stable editor attachment

CodeMirror construction and teardown stay in `SqlEditor.svelte`'s attachment, but the one-time attachment body runs inside Svelte `untrack`. Reactive document, dialect/completion, wrapping, and editable-state changes continue through their existing targeted effects and CodeMirror compartments. Normal typing therefore updates the existing editor view instead of recreating it.

The browser regression records the actual `.cm-editor` node, types multiple characters, waits beyond draft-recovery debounce, and requires the same node, complete text, retained `.cm-content` focus, and no recovery banner.

### Connection-grouped presentation

The persisted `WorkspaceView.tabs` array remains flat and backward compatible. The sidebar derives one collapsible group per saved profile and one Offline group for unbound SQL files and detached drafts. The active group expands automatically, while expansion state remains ephemeral UI state. The horizontal tab strip is removed.

Each child row exposes dirty, pinned, table-data, and session state; close remains directly reachable; rename, duplicate, pin, and group-local reordering live in a compact overflow control. Selecting a profile expands it and activates its first existing child, creating a query only when the group is empty. Every group also has an explicit new-query action. Tabs cannot move between profiles or from Offline without a separate future binding design.

### Profile connection and tab sessions

Connect and Disconnect remain profile-level actions. Selecting a bound child under an established profile connection lazily requests that child's dedicated native session using its saved context. A newly created child under an established connection opens its session immediately. Restored unused children remain offline; automatic profile reconnect may open only the restored active child.

All user tab activation, including `Ctrl+Tab`, goes through one activation helper. Per-tab session opens are deduplicated by tab identifier. A failed open leaves the metadata/profile connection intact, keeps that child offline, records a scoped error, and offers Retry without changing context. Completion never changes the active tab and focuses the editor only if that tab is still active.

Pending session opens are connection operations for safety purposes. They block tab close, profile disconnect, safe window close, and updater handoff until terminal. Existing execution, transaction, staged-edit, context, cancellation, result, and session-isolation rules remain unchanged. No native session is shared between children.

### Export guidance

CSV formula-prefix, configurable NULL-token, and binary-format guidance lives inside the existing expanded Export control. Merely receiving rows does not display a persistent export warning, and export does not add a confirmation dialog.

## Consequences

- No Tauri command, generated contract, database schema, or workspace migration changes.
- Profile metadata sessions and tab execution sessions remain separate adapter resources.
- Restoring many tabs does not eagerly consume database connections.
- The sidebar becomes the single tab-navigation surface and may use more vertical space for profiles with many children; groups are collapsible to keep that cost bounded.
- Native Windows interaction still needs physical validation for continuous typing, multiple isolated child sessions, transaction isolation, export disclosure, and disconnect during an active or pending child operation.

## Validation

Frontend integration tests use an in-memory Tauri workspace to cover profile children, Offline drafts, profile selection, profile-level connection, selected-child lazy open, immediate new-child open, failure Retry, request deduplication, and pending disconnect/window-close blocking. Result-grid tests keep export guidance inside the closed Export control. The real Chromium gate verifies editor identity/focus through typing and recovery debounce alongside the existing large/narrow layout matrix.
