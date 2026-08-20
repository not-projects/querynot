# ADR 0012: Unified file connections and compact workbench lifecycle

- Status: Accepted
- Date: 2026-08-20
- Decision owner: QueryNot product owner
- Extends: [ADR 0007](0007-productivity-and-safe-data-editing.md) and [ADR 0011](0011-signed-windows-auto-updates.md)

## Context

The released workbench exposed separate Create connection, Open SQLite file, Create SQLite file, and Open SQL file offline actions in the connection sidebar. This mixed connection targets with SQL document actions, required the user to name the adapter before choosing a file, and consumed persistent space. The window-close path also asked for a generic decision even when local recovery could make close safe without changing source files. Returned rows were docked in a fixed nested-scroll layout that could leave either the editor or the result grid unusably small.

Native execution events can also arrive before the asynchronous `start_execution` command response. Treating the command response as the only initialization boundary can discard the first result batch even though the database execution succeeded.

## Decision

Create connection is the only profile-creation entry. A new profile chooses Server or File, and that target type becomes immutable after creation. Server retains the exact MySQL/MariaDB host configuration. File invokes one `pick_connection_file` native command without an extension filter. Rust validates one explicitly selected regular file by opening it read-only through the supported SQLite adapter, then returns only an opaque grant, display name, and detected kind. It does not scan directories, infer support from an extension, disclose the full path to the WebView, or mutate the selected file. Creating a new database file is deferred.

SQL documents are not connection profiles. New query, Open SQL file, Save, and Save as live in a compact File menu while their keyboard shortcuts remain available.

The execution listener is installed before workspace bootstrap. Execution events are processed serially, and the first valid sequence-zero batch initializes the result set atomically by execution ID even when it beats the command response. Empty first batches remain visible and are acknowledged through the existing bounded-stream contract.

A normal window close no longer opens a confirmation dialog. QueryNot silently saves enabled workspace recovery, closes clean tab sessions, and destroys the window without executing SQL or writing through to SQL source files. An active execution, unresolved transaction, staged table edit, connection operation, failed recovery save, or dirty query while restoration is disabled keeps the window open. The workbench selects the affected tab or connection context when possible and reports the required action in the status surface. Updater handoff uses the same blockers and recovery boundary.

The query and result panes share a horizontal separator backed by `workspace.panel_sizes.results_percent`. The percentage defaults to 35, is clamped to 20–70, persists through the existing workspace snapshot, supports pointer drag plus Arrow/Home/End keyboard adjustment, and resets to 35 on double-click. Only the selected result set renders its virtualized grid; additional sets use compact tabs. The results pane itself does not add a second vertical scrollbar, and export variants live behind one grouped control.

## Consequences

- File-type detection remains native-authoritative and local-only, and arbitrary filename extensions are accepted when the file is a valid supported SQLite database.
- A cancelled or unsupported selection creates no profile and grants no reusable frontend path.
- Existing profiles and stored workspaces need no migration because profile targets and panel-size storage are unchanged.
- Safe application close becomes immediate, while unsafe close remains fail-closed and actionable.
- Multiple result sets remain available without stacking several large scroll regions.
- New SQLite file creation remains an explicit follow-up and must reuse the File connection path rather than add another permanent sidebar action.

## Validation boundary

Frontend tests cover early and empty first batches, the unified first-run routes, close blockers, persisted splitter bounds, result virtualization, and generated command drift. Rust formatting and workspace compilation cover the native detection command. Native Windows interaction still requires physical verification of the file dialog, pointer resize, keyboard separator, and title-bar close behavior before those observations are claimed.
