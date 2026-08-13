# Release traceability

`requirements.json` is the checked-in release traceability matrix required by PRD section 12.4. It is generated from the stable requirement identifiers and acceptance criteria in `docs/product-requirements.md`, then merged with reviewed records from `status-overrides.json`.

Run `npm run traceability:sync` after the PRD or an evidence mapping changes. CI runs `npm run test:traceability` and fails if:

- the PRD no longer yields exactly 101 numbered requirements and 20 acceptance criteria;
- an identifier is duplicated or an override names an unknown identifier;
- a must requirement has no planned or executable verification mapping;
- a row is marked `verified` without a retained repository-relative evidence link;
- an exception has no expiry; or
- the generated matrix is stale.

## Status convention

- `planned`: scoped to an owning phase with reserved verification IDs.
- `in_progress`: implementation or verification is active.
- `implemented`: behavior exists but all required evidence is not yet retained.
- `verified`: mapped verification passed on every claimed matrix entry and evidence is retained.
- `blocked`: a release-blocking dependency or external verification is unresolved.
- `excepted`: the product owner approved a time-bounded exception with an expiry.

`PLANNED-AUTO-*` and `PLANNED-MAN-*` are reservations, not evidence. A row cannot become `verified` until those placeholders are replaced by executable test and procedure identifiers and the evidence links point to passing artifacts under `evidence/`.
