# ADR-0008: ProjectIndexer.index() Diagnostics Return Channel

## Status

Accepted (amit13091992@gmail.com)

## Context

`ProjectIndexer.index()` (`packages/core/src/analyzer/pipeline.ts`) returns only
`{ project, graphs }`. `parserProjectIndexer` (`packages/parser/src/project-indexer.ts`) already
produces real `Diagnostic`s per file — `parseFile`/`parsePythonFile` convert a caught `ParseError`
into a `Diagnostic` as part of `ParsedFileResult.diagnostics` (`packages/core/src/errors/errors.ts`
already defines `Diagnostic`; no new type is needed) — and the indexer also makes a size-skip
decision (`MAX_PARSEABLE_FILE_SIZE_BYTES`) that has no `Diagnostic` representation at all. Both are
currently only reachable via `logger.debug()` calls, so they never reach `ScanResult.diagnostics`
(`packages/core/src/serialization/scan-result.ts`), even though `AnalysisResult.diagnostics`
(`packages/core/src/analyzer/result.ts`) proves the platform already has a working pattern for
"per-stage diagnostics flow into the final result" for the *analyze* stage. The *index* stage has no
equivalent. This was flagged during Phase 2 review, re-confirmed during Phase 3 review, and tracked
in `docs/project-status.md`'s technical debt section as "should land before more
`ProjectIndexer`-adjacent consumers exist" — true today of `graphProjectIndexer`, which composes
`parserProjectIndexer` and would otherwise need to invent its own parallel workaround.

`ProjectIndexer` is a Section 37C-listed contract (`PipelineStrategies` in
`packages/core/src/analyzer/pipeline.ts`), so this change requires an ADR before implementation.

### Consumers inspected (Section 46)

Grepped `ProjectIndexer`/`indexer.index`/`.index(` across `packages/*/src`:

- `packages/core/src/analyzer/pipeline.ts` — defines the `ProjectIndexer` interface (this change).
- `packages/core/src/analyzer/engine.ts` — `ScanEngine.scan()` calls
  `this.strategies.indexer.index(...)` and currently discards everything but `project`/`graphs`;
  must start collecting `diagnostics` into the same array it already merges analyzer diagnostics
  into.
- `packages/parser/src/project-indexer.ts` — `parserProjectIndexer`; already computes per-file
  `Diagnostic[]` and a size-skip condition, currently logged and dropped; must return them.
- `packages/graph/src/project-indexer.ts` — `graphProjectIndexer`; composes
  `parserProjectIndexer.index()` and must forward its `diagnostics` through its own return value
  unchanged (it introduces no new diagnostics itself).
- `packages/cli/src/commands/scan.ts` — inline passthrough indexer literal
  (`indexer: { index: async (project) => ({ project, graphs: {} }) }`, the Phase 0 stub still used
  because `scan` isn't wired to a real indexer yet); must satisfy the new interface shape (an empty
  `diagnostics: []` is correct here, not a gap — there is genuinely nothing to report).
- `tests/core/scan-engine.test.ts` — fixture `ProjectIndexer` implementations; must satisfy the new
  return shape.
- `tests/parser/project-indexer.test.ts`, `tests/graph/*` — existing indexer tests; extend rather
  than replace, per Section 46/52.

No other package implements or consumes `ProjectIndexer`.

## Decision

- **Reuse the existing `Diagnostic` type** (`packages/core/src/errors/errors.ts`) — no new
  diagnostic/error type is introduced. It already has `code`/`severity`/`message`/`source`/
  `filePath`/`cause`, which covers both a parse failure and a size-skip.
- **`ProjectIndexer.index()`'s return type gains a required `diagnostics: readonly Diagnostic[]`
  field**, matching the shape `AnalysisResult` already established for the analyze stage:

  ```ts
  export interface ProjectIndexer {
    index(project: ProjectModel, logger: Logger): Promise<{
      project: ProjectModel;
      graphs: GraphAccess;
      diagnostics: readonly Diagnostic[];
    }>;
  }
  ```

- **`ScanEngine.scan()` pushes `indexed.diagnostics` into the same `diagnostics` array it already
  merges analyzer-stage diagnostics into**, before the `analyze` stage begins — no new field on
  `ScanResult` (it already has `diagnostics`), no new event type, no change to `AnalysisResult`.
- **`parserProjectIndexer` collects, rather than only logs**: each file's `ParsedFileResult.diagnostics`
  are pushed into a running array; the size-skip case gains a real `Diagnostic` — new code
  `"FILE_SKIPPED_SIZE_LIMIT"`, `severity: "info"`, `source: "parser"`, `filePath: file.path`,
  message naming the file's size and the limit. `logger.debug()` calls stay as-is (the diagnostics
  channel and structured logging are complementary, not a replacement for each other — logging is
  for operators tailing a run, diagnostics are for the persisted `ScanResult`).
- **`graphProjectIndexer` forwards `parsed.diagnostics` unchanged** in its own return value; it adds
  no diagnostics of its own this phase (module/symbol resolution failures — e.g. an unresolvable
  `IMPORTS` specifier — are a deliberate non-goal already documented in `docs/project-status.md`'s
  technical debt, not silently swallowed by this change).
- **`packages/cli/src/commands/scan.ts`'s passthrough stub returns `diagnostics: []`** — it has no
  parsing to report on; this is correct, not a workaround.

## Alternatives considered

- **A separate `IndexerResult` type instead of an inline return-type field.** Rejected: the inline
  object literal is already the established pattern for this interface (`{ project, graphs }`);
  wrapping it in a named type is a bigger, non-additive shape change to every implementer's return
  statement for no behavioral benefit. Revisit only if a third field is ever needed and the literal
  starts feeling unwieldy.
- **A new `IndexDiagnostic` type distinct from `Diagnostic`.** Rejected: `Diagnostic` already models
  everything needed (severity, code, message, source, optional filePath/cause); a parallel type
  would fragment `ScanResult.diagnostics` into two shapes for no gain, violating "prefer extending
  an existing domain model over introducing a parallel abstraction" (Section 35.12).
  `AnalysisResult.diagnostics` already reuses this exact type for the analyze stage — this is
  consistency, not a new precedent.
  - **Making the size-skip threshold configurable via `AnalyzerConfig` in the same change.**
  Rejected: out of scope for this ADR — it's a separately tracked technical-debt item
  (`docs/project-status.md`). Making the skip *visible* as a `Diagnostic` (this ADR) does not
  require making the threshold itself configurable; bundling them would scope-creep a small,
  verifiable contract change into a bigger one (Section 52).
- **Emitting a `ScanEvent` for index-stage diagnostics instead of/in addition to the return channel.**
  Rejected for now: `AnalysisResult.diagnostics` doesn't emit a dedicated event either (only
  `finding:emitted` exists per-finding); adding index-stage-diagnostic events would be a scope
  expansion beyond closing the parity gap this ADR targets. Nothing prevents adding one later if a
  consumer needs streaming visibility into index diagnostics specifically.

## Consequences

- `ProjectIndexer` implementers (today: `parserProjectIndexer`, `graphProjectIndexer`, the CLI's
  passthrough stub, and any test fixture indexer) all need a mechanical, same-shape update — listed
  above under Consumers inspected. This is a breaking change to a Section 37C contract, hence the
  ADR requirement; it is not optional-field-additive because `noUncheckedIndexedAccess`/
  `exactOptionalPropertyTypes` discipline in this repo prefers a required field with an explicit
  `[]` over an optional one that implies "diagnostics may or may not exist" (ADR-0004's
  uncertainty-preservation principle — "no diagnostics" should be represented as an empty array, a
  known fact, not an absent field).
- `ScanResult.diagnostics` will, for the first time, actually contain parser-stage findings (a
  malformed file, a size-skip) instead of only whatever `Analyzer` implementations report — closing
  the exact gap flagged in Phase 2/3 review. The CLI's JSON/SARIF/HTML exporters
  (`packages/cli/src/exporters/`) already read `ScanResult.diagnostics` structurally, so no exporter
  change is required for this data to become visible in existing report formats.
- No change to `packages/core`'s zero-workspace-dependency rule, no new third-party dependency, no
  new package.
- Once implemented, the two related technical-debt notes in `docs/project-status.md` (the
  diagnostics-channel gap itself, and the "surfacing the skip as a visible `Diagnostic` once
  ADR-0008 exists" follow-up under the file-size-limit entry) should be moved from "Known technical
  debt" into "Completed components"/"Known architectural decisions" — but only after a human signs
  off per Section 49; this ADR does not itself constitute that sign-off.
