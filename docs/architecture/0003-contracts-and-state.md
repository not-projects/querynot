# ADR 0003: Commands, events, identifiers, and state machines

Date: 2026-08-13
Status: Accepted; Phase 1 foundation implemented locally

## Public contract

`contracts/querynot.v1.json` is the source of truth for public Tauri commands and events. `npm run contracts:sync` generates Rust and TypeScript bindings; `npm run test:contracts` fails when either binding differs. Breaking changes increment `contract_version`; long-running jobs return an opaque job identifier before emitting bounded events.

Opaque UUIDv7 newtypes distinguish profiles, tabs, native sessions, executions, and result sets. A syntactically valid identifier is never sufficient authority: the native owner graph must prove window, profile, tab, session, and job relationships before access.

## State-machine convention

Each required PRD state machine will be a total, unit-tested transition table in `querynot-core`. A transition receives the current state plus a typed event and returns either the next state plus explicit effects or a safe invalid-transition error. UI state is a projection; it cannot force a native success transition.

The Phase 1 implementation must cover:

- profile/connection lifecycle;
- tab online/offline, dirty, running, and close decisions;
- native session and transaction state including unknown state;
- execution/cancellation lifecycle;
- result streaming, tranche pause, expiry, and disposal;
- table-data clean/staged/previewing/applying/conflicted state;
- local-store healthy/degraded/migration-failed state; and
- export planned/writing/completed/failed/cancelled state.

Phase 1 implements all eight tables in `querynot-core::state`. Each table returns typed state and explicit effects, and unit tests cover permitted and rejected transitions. Connection, execution, result, mutation, and export tables are foundations only until their later vertical slices own real resources.

## Event integrity

Every future long-running event includes contract version, owner identifier, job/execution identifier, sequence, bounded payload size, and exactly one terminal state. The native registry rejects cross-owner access; the frontend projection rejects duplicate, late, unknown, oversized, or out-of-order events. Reload and close trigger native ownership cleanup even when no listener remains.

Phase 1 implements the owner graph in `querynot-core::ownership`. Profiles, offline tabs, native sessions, and executions form a window/profile/tab/session chain; terminal jobs reject late access. The Tauri bootstrap cleans the prior frontend generation and re-registers only restored native-issued identifiers, while destroyed windows clear session secrets and file grants. Later phases must attach real job/session cleanup effects to the existing cleanup plan.
