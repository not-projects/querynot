# ADR 0021: Graph-first Explain and local hotspot estimates

Date: 2026-09-03
Status: Implemented in current source

## Context

ADR 0020 established estimated-only Explain, bounded normalization, lossless Raw fidelity, and the absence of tuning recommendations. A linear Tree is complete and accessible, but it makes parent/child plan structure slower to scan. Some engines also report numeric cost or row estimates that can help users locate relatively prominent nodes, provided QueryNot does not turn those estimates into quality scores or elapsed-time predictions.

A true duration predictor is outside this extension. It would require representative execution data, a privacy and persistence design, engine-specific calibration, uncertainty communication, and independent validation. None of those boundaries are implied by an engine's planner cost or row estimate.

## Decision

Normalized plans open in **Graph** when they contain at most 250 nodes. Graph uses a deterministic, dependency-free top-down layout with positioned HTML node buttons over decorative SVG connectors. It supports 50–150% zoom in 10% steps, resets view-local zoom for each new plan, and keeps overflow inside the plan viewport. Each card shows the operation, relation, and primary reported estimate. Focusing or selecting a card opens an inspector that exposes every normalized field without truncation.

Graph uses roving focus that follows plan structure: Up moves to the parent, Down to the first child, Left and Right across siblings, Home to a root, and End to the last visual node. **Tree** remains the complete linear keyboard alternative. Plans above 250 nodes open in Tree with Graph disabled and explicit copy that Tree and Raw retain the complete plan. Raw-only plans continue to open in Raw. Raw display and exact-copy behavior remain unchanged.

Settings adds `plan_hotspot_estimates_enabled`, defaulting to `false` for new, existing, and reset settings. Enabling **Experimental plan hotspot estimates** augments subsequent ordinary Explain results. It does not add a command, database request, event, or plan payload field.

## Relative ranking

Ranking is derived locally from the current normalized plan and accepts only finite, non-negative numeric strings:

1. Use `total_cost` when at least two nodes report valid values.
2. Otherwise use `estimated_rows` when at least two nodes report valid values.
3. Otherwise report **Relative estimate unavailable** and leave every node neutral.

Equal values share one rank. Distinct values are ordered from lowest to highest and mapped to three textual bands: lower, middle, and upper quartile. Neutral surfaces represent lower estimates, while middle and upper bands use progressively stronger theme-derived amber emphasis. Red, green, and labels such as “bad,” “good,” or “expensive” are excluded because planner estimates are neither runtime measurements nor query-quality judgments.

Color is never the only carrier. The view names the selected metric and coverage, includes a three-band legend, lists the three highest reported estimates, prints the band on annotated nodes, and repeats it in the inspector. Forced-colors rendering retains focus and textual band distinctions.

## Fidelity, privacy, and product boundaries

The existing `start_explain` command, `query_explain` event, and `ExplainPlanView` payload remain unchanged. Layout, selection, zoom, and derived rankings are local Explain-view state. SQL, schemas, raw plans, normalized plans, and rankings remain on-device and ephemeral. Plan payloads and derived ranks are not written to History or operational logs.

The Explain information popover states that the database receives a non-executing estimated-plan request, ranking is local and within-plan only, and no elapsed time is predicted. It links directly to the hotspot setting with explicit focus transfer and return.

This decision does not add `EXPLAIN ANALYZE`, duration forecasting, history-trained models, AI tuning advice, query rewrites, external services, plan persistence, comparison, or export. Any future duration predictor requires a separate architecture, privacy, calibration, and validation decision.

## Consequences

Most normalized plans gain a faster structural overview without weakening the complete Tree/Raw fallbacks or Raw fidelity boundary. The 250-node cutoff bounds DOM and connector work independently of ADR 0020's larger native normalization limit. Engines that omit comparable estimates, especially many SQLite plans, remain useful in neutral Graph and Tree views without fabricated scoring.

## References

- [ADR 0020: Bounded estimated query plans](0020-estimated-query-explain.md)
