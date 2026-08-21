# ADR 0015: Reliable Windows shortcuts and calm workbench hierarchy

- Status: Accepted
- Date: 2026-08-21
- Scope: Unreleased desktop interaction and visual refinement
- Complements: [ADR 0014](0014-connection-scoped-tabs-and-history-drawer.md)

## Context

The Windows-only support envelope made CodeMirror's platform-dependent `Mod` alias misleading: the interface described Command-like bindings and users tried the Windows key, while the intended execution flow was Control-based. Settings also applied UI-scale preview to its own dialog as the slider moved, causing the control under the pointer to resize and making the range difficult to use.

The connection-scoped workbench repaired navigation and result geometry, but its visual hierarchy still gave equal emphasis to brand metadata, context labels, secondary toolbar actions, and status help. Repeated eyebrow labels, bordered capsules, bright engine tiles, rounded tab cards, and a long shortcut sentence made a functional screen feel less settled than the compact desktop workflow required.

## Decision

Query and document shortcuts use literal Windows Control bindings. `Ctrl+Enter` runs the current execution unit, `Ctrl+Shift+Enter` runs all statements, and the existing Control-based cancel, file, focus, find, and visible-tab actions remain explicit. Shortcut labels and `aria-keyshortcuts` describe the same bindings. The editor keymap keeps execution bindings at highest precedence so CodeMirror extensions cannot consume them first.

UI-scale preview continues to update the application behind Settings immediately. When Settings opens, it captures the current scale for that dialog; moving the slider does not change the dialog's dimensions. Closing and reopening Settings adopts the saved scale. Other dialogs use the current application scale.

The main screen keeps ADR 0014's connection list, scoped top tabs, context bar, editor/result tracks, and History drawer. Its presentation is flattened:

- the compact header uses plain brand and connection-status text;
- connection engine marks are restrained and selected rows use a narrow active accent;
- active tabs use a bottom accent while overflow and close controls appear on hover, focus, or the active tab as appropriate;
- the editor and result headings avoid repeated eyebrow labels and capsule badges;
- execution and document actions form two groups, with Run as the only dominant action;
- connected drafts are labelled accurately instead of appearing as offline files;
- the status bar retains live state and only the three primary shortcut reminders.

The database identity, selected context, transaction state, execution state, explicit-execution guidance, result-fetch disclosure, and color-independent status text remain visible. This is a hierarchy change, not a reduction of safety information.

## Consequences

- No native command, adapter, credential, persistence, workspace, or session-lifecycle contract changes.
- Windows users receive one unambiguous shortcut vocabulary in the UI, editor, tests, and requirements.
- Scale preview remains immediate without moving the active Settings control.
- The workbench uses fewer competing accents while preserving familiar navigation and operational context.
- The visual treatment continues to use QueryNot tokens and assets; MongoDB Compass remains an interaction cue only.
- Browser automation can verify geometry and behavior, but native Windows font rendering, pointer feel, and accessibility observation remain manual checks.

## Validation

Unit and integration tests cover literal Control routing, stable Settings-dialog scale, workspace preview scale, and existing tab/session safeguards. The populated Chromium fixture executes through `Ctrl+Enter`, checks the compact header, two toolbar groups, concise status help, readable connection rows, scoped tabs, result visibility, split geometry, History overlay, responsive widths, and 150% application scaling.
