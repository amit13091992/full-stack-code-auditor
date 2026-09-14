# Analyzer Lifecycle

Implemented by `ScanEngine` in `packages/core/src/analyzer/engine.ts`, invoked through the
`AnalyzerClient` facade (`packages/core/src/analyzer/client.ts`, see ADR-0002 for why there are two
names). Every consumer — CLI, CI action, future IDE extension — calls the same `ScanEngine.scan()`.

## Stages

```
initialize -> discover -> index -> analyze -> correlate -> finalize
```

`initialize` is implicit in `AnalyzerClient` construction (config + registry + strategies wiring).
The remaining five stages are explicit and each emits `stage:started` / `stage:completed` events.

1. **discover** — `PipelineStrategies.discoverer.discover(root, config, logger)` returns a
   `ProjectModel`. In Phase 0 this is supplied by the caller (see the test fixtures in
   `tests/core/scan-engine.test.ts`); `@code-analyzer/project-model` will provide the real Phase 1
   implementation.
2. **index** — `PipelineStrategies.indexer.index(project, logger)` returns the (possibly enriched)
   `ProjectModel` plus a `GraphAccess` bundle of graphs. This is where parsing (Phase 2) and graph
   construction (Phase 3-5) happen, behind one seam.
3. **analyze** — for every `Analyzer` in the `AnalyzerRegistry` (or the subset named in
   `ScanOptions.analyzers`) whose `supports(context)` returns `true`, `analyze(context)` runs and
   its `AnalysisResult.findings`/`evidence`/`diagnostics` are collected. Each analyzer receives one
   shared, read-only `AnalyzerContext` — see `packages/core/src/analyzer/context.ts`.
4. **correlate** — if a `FindingCorrelator` strategy is configured, it runs across the full finding
   set (Section 21); then, if a `RiskCalculator` strategy is configured, it scores the (possibly
   merged) findings (Section 22). Both are optional — a `minimal` profile scan may have neither.
5. **finalize** — assembles the `ScanResult` (schema-versioned, see
   `packages/core/src/serialization/scan-result.ts`), computes the summary, emits
   `scan:completed`.

Cancellation (`ScanOptions.signal`) is checked at the start of each stage via
`ScanCancelledError` — a cancelled scan emits `scan:cancelled` instead of `scan:completed` and the
promise rejects; callers must not treat a rejected `scan()` promise as a crash when the rejection
is a `ScanCancelledError`.

## Why analyzers don't parse files themselves

Section 2 explicitly rejects a `file -> regex/rule -> issue` architecture. `AnalyzerContext.project`
is the *only* view of source an `Analyzer` gets — no file handles, no direct filesystem access. This
is what makes analyzers portable across the CLI, CI action, and any future IDE extension without
each of them re-implementing discovery/parsing, and what makes incremental analysis (Section 29)
possible: the indexer, not each analyzer, decides what needs re-parsing.

## Extending the lifecycle

Do not add a new top-level stage without an ADR — the six stages above are a frozen contract
(Section 37D says "define ... where appropriate", and Section 46 requires inspecting all consumers
before changing a core contract). Sub-stages within `analyze` (e.g. per-category ordering) may be
added inside `packages/engines` without touching `ScanEngine`.
