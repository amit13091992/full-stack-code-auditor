# ADR-0004: Finding/Evidence Separation and Uncertainty Preservation

## Status

Accepted

## Context

Section 19 requires findings to distinguish `DETECTED`, `LIKELY`, `CONFIRMED`,
`RUNTIME_CONFIRMED` rather than presenting all static findings as equally certain. Section 20
requires evidence to be machine-readable and separate from the human-readable description.
Section 21 requires correlation of findings from different analyzers into one root-cause finding.
Section 35.8 says: "Preserve uncertainty rather than hiding it."

## Decision

- `Finding` (`packages/core/src/domain/finding.ts`) carries `status: FindingStatus`
  (`detected | likely | confirmed | runtime_confirmed | false_positive`), a numeric `confidence`
  (0-1), and `evidenceIds` pointing at separately stored `Evidence` records — it never inlines
  the justification as a free-text-only field.
- `Evidence` (`packages/core/src/domain/evidence.ts`) is its own entity with a typed `kind`
  (`ast-pattern | symbol-resolution | call-graph-path | data-flow-path | dependency-metadata |
  config-value | runtime-observation | external-tool`) and a `locations` array that must resolve to
  real `SourceLocation`s — an engine cannot emit evidence that doesn't point at something in the
  repository (or name an external tool via `sourceTool`).
- `Finding.correlatedFindingIds` lets the (not-yet-implemented) Correlation Engine in
  `packages/engines` merge multiple analyzers' findings under one root-cause finding without
  discarding the originals — Section 21's requirement that four related findings collapse into one
  root issue, not four unrelated ones.
- `Dependency.used` / `Dependency.reachable` (`packages/core/src/domain/dependency.ts`) are
  `boolean | undefined`, not `boolean` defaulting to `false` — "installed" must never silently imply
  "not reachable" (Section 13) before reachability analysis has actually run.
- `EdgeCertainty` on graph edges (ADR-0003) is the same principle applied to the call graph:
  `unknown`/`dynamic` are first-class values, not absence of an edge.

## Alternatives considered

- **A single boolean `confirmed` flag instead of a status enum.** Rejected: collapses
  "statically detected", "manually/AI-reviewed as likely", and "proven via runtime probe" into one
  bit, which is exactly the false certainty Section 19 warns against.
- **Inline evidence as a string field on Finding.** Rejected: Section 20 explicitly wants
  machine-readable evidence kept separate from the human-readable description, so downstream
  consumers (AI investigation layer, dashboards) can reason over evidence structurally instead of
  parsing prose.
- **Default `used`/`reachable` to `false` until proven otherwise.** Rejected per Section 13's
  explicit "do not treat installed as equivalent to exploitable" — defaulting to `false` is just as
  wrong as defaulting to `true`; "not yet analyzed" must be representable.

## Consequences

- Any analyzer that cannot yet compute `Finding.confidence` honestly must not invent a number —
  Phase 0 leaves this as a required field precisely so that decision is forced at analyzer-authoring
  time (see `docs/tasks/` for how each analyzer's confidence is justified).
- The Risk Engine (Section 22, `packages/engines`) consumes `RiskFactors` on `Finding.risk`, which
  is optional and only populated once a `RiskCalculator` strategy has actually run — `ScanEngine`
  (Section 37D) leaves `finding.risk` undefined when no `riskCalculator` strategy is configured,
  rather than emitting a fabricated score.
