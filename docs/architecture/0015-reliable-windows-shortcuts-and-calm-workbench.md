# ADR 0015: Reliable Windows shortcuts and calm workbench hierarchy

- Status: Accepted
- Date: 2026-08-21
- Scope: Unreleased desktop interaction and visual refinement
- Complements: [ADR 0014](0014-connection-scoped-tabs-and-history-drawer.md)

## Context

The Windows-only support envelope made CodeMirror's platform-dependent `Mod` alias misleading: the interface described Command-like bindings and users tried the Windows key, while the intended execution flow was Control-based. Settings also applied UI-scale preview to its own dialog as the slider moved, causing the control under the pointer to resize and making the range difficult to use.

The connection-scoped workbench repaired navigation and result geometry, but its visual hierarchy still gave equal emphasis to brand metadata, context labels, secondary toolbar actions, and status help. Repeated eyebrow labels, bordered capsules, bright engine tiles, rounded tab cards, and a long shortcut sentence made a functional screen feel less settled than the compact desktop workflow required. A later full-window review at 150% scale also showed tabs stretching across the row, repeated visible dirty labels, the new-tab action detached from its strip, and Offline document actions stranded at the far edge of the editor.

At large saved UI scales, dialog cards were sized against the unscaled viewport and then enlarged with the rest of the shell. A card could therefore extend above and below the physical screen while its own scrollbar could not recover the clipped title or actions. Font characters were also standing in for common control icons, and the schema tree's ambiguous **Data** row action obscured the structural metadata already returned by the native adapter.

## Decision

Query and document shortcuts use literal Windows Control bindings. `Ctrl+Enter` runs the current execution unit, `Ctrl+Shift+Enter` runs all statements, and the existing Control-based cancel, file, focus, find, and visible-tab actions remain explicit. Shortcut labels and `aria-keyshortcuts` describe the same bindings. The editor keymap keeps execution bindings at highest precedence so CodeMirror extensions cannot consume them first.

UI-scale preview continues to update the application behind Settings immediately. When Settings opens, it captures the current scale for that dialog; moving the slider does not change the dialog's dimensions. Closing and reopening Settings adopts the saved scale. Other dialogs use the current application scale. Every scaled backdrop uses inverse-scale viewport dimensions and owns the scroll range; the card is capped to that logical viewport so its title and final actions remain reachable at up to 200% scale.

The main screen keeps ADR 0014's connection list, scoped top tabs, context bar, editor/result tracks, and History drawer. Its presentation is flattened:

- the compact header uses plain brand and connection-status text;
- connection engine marks are restrained and selected rows use a narrow active accent;
- active tabs use a bottom accent while overflow and close controls appear on hover, focus, or the active tab as appropriate;
- the editor and result headings avoid repeated eyebrow labels and capsule badges;
- execution and document actions form two groups, with Run as the only dominant action;
- connected drafts are labelled accurately instead of appearing as offline files;
- the status bar retains live state and only the three primary shortcut reminders.

The database identity, selected context, transaction state, execution state, explicit-execution guidance, result-fetch disclosure, and color-independent status text remain visible. This is a hierarchy change, not a reduction of safety information.

The horizontal tab strip uses compact bounded tab widths rather than distributing tabs across the available row. Dirty state is a labelled SVG edit mark, the new-tab action remains adjacent to the strip, and document actions align with the editor when no execution controls are available.

Icon-only controls use one dependency-free inline SVG component with `currentColor` styling. SVG paths remain decorative inside labelled buttons, summaries, or status elements. The schema tree uses those icons for disclosure and object kinds, but remains navigation-only. Selecting a table or view opens or activates a connection-scoped main-workspace object tab whose primary view contains the existing columns, types, primary keys, defaults, generated fields, indexes, and foreign keys. The former ambiguous **Data** action becomes secondary **Browse rows** inside the object tab. Opening structure uses only the profile metadata session; the isolated table session and its first row fetch are deferred until **Browse rows** is chosen.

## Consequences

- No native command, adapter, credential, persistence, workspace, or session-lifecycle contract changes.
- Windows users receive one unambiguous shortcut vocabulary in the UI, editor, tests, and requirements.
- Scale preview remains immediate without moving the active Settings control, and reopened scaled dialogs stay within the physical viewport with reachable header and footer controls.
- Shared SVG artwork gives icon controls consistent geometry without adding a dependency or changing accessible names.
- Structure-first schema tabs use the existing adapter contract, preserve the narrow sidebar for navigation, and make row browsing an explicit lazy mode.
- The workbench uses fewer competing accents while preserving familiar navigation and operational context.
- The visual treatment continues to use QueryNot tokens and assets; MongoDB Compass remains an interaction cue only.
- Browser automation can verify geometry and behavior, but native Windows font rendering, pointer feel, and accessibility observation remain manual checks.

## Validation

Unit and integration tests cover literal Control routing, stable Settings-dialog scale, viewport-bounded modal CSS, shared SVG icon usage, compact tab alignment, main-workspace structure tabs, lazy row-session allocation, and existing tab/session safeguards. The populated Chromium fixture executes through `Ctrl+Enter`, inspects columns, keys, indexes, and foreign keys without opening a table session or fetching rows, and checks the compact header, concise status help, readable connection rows, scoped tabs, result visibility, split geometry, History overlay, and responsive widths. Retained 1915×1237 Playwright captures review the Offline workbench and schema structure at 150% application scale. A separate 200%-scale Settings check uses a 600px-high viewport and scrolls to both the bottom Save action and top Close control.
