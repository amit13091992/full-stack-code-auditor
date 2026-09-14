# Task: Phase 2 — AST & Semantic Source Model (IMPLEMENTED — pending human review)

> Approved by amit13091992@gmail.com. ADR-0006 (parser choice/ID scheme/per-file scope) accepted;
> implementation complete and tested. Wiring `packages/cli`'s `scan` command to use the real
> `parserProjectIndexer` instead of its current passthrough stub was intentionally left out of this
> task's scope (that's `docs/tasks/cli-and-reporting.md`'s concern) — flagged as a natural follow-up
> in `docs/project-status.md`.

## Objective

Implement the parser adapter in `@code-analyzer/parser` that turns each JavaScript/TypeScript
`SourceFile` discovered in Phase 1 into the normalized semantic model already frozen in
`packages/core/src/domain`: `Module`, `Symbol`, `SymbolReference`, `ImportBinding`,
`ExportBinding`, `FunctionEntity`, `ClassEntity`. Wire it into a real `ProjectIndexer`
(`packages/core/src/analyzer/pipeline.ts`) and verify end-to-end through `AnalyzerClient`, the way
Phase 1 verified `projectModelDiscoverer` end-to-end (`docs/tasks/phase-1-repository-discovery.md`,
ADR-0005).

## Scope

- **Parser choice: TypeScript Compiler API** (`typescript` package, `allowJs: true`), used for both
  `.js`/`.jsx` and `.ts`/`.tsx` files — not Tree-sitter. Reason: Section 2 requires real symbol
  identity and declaration/reference resolution, not just a syntax tree; the TS compiler API gives
  us a real binder/checker for that on day one, whereas Tree-sitter would need a second resolution
  layer built on top. Tree-sitter stays the documented option (`docs/parser/overview.md`, Section 4)
  for a future non-JS/TS language, where no compiler-API equivalent exists. This decision needs an
  ADR before implementation starts (`ADR-0006`, per Section 43 — "Tree-sitter vs. TypeScript
  compiler API... per language" was explicitly left open in `docs/parser/overview.md`).
- **Per-file, not cross-file.** Phase 2 parses each file in isolation: every `ImportBinding`'s
  `resolvedModuleId` is left `undefined` (Section 2's uncertainty-preservation rule, ADR-0004) —
  resolving an import specifier to another file's `Module` requires seeing the whole project, which
  is Phase 3's Module Graph, not this phase. Don't reach ahead and hand-resolve imports here.
- **Which files get parsed**: every discovered `SourceFile` with `language` in
  `{javascript, typescript}` whose `classification` is not `generated`, `vendored`, or `asset`
  (Phase 1's `SourceClassification`, `packages/core/src/domain/file.ts`). `test`-classified files
  are parsed — the call graph (Phase 4) and future test-coverage analyzers need them.
- **Produces, per parsed file**: one `Module`, its declared `Symbol[]` (functions, classes,
  interfaces, type aliases, enums, top-level variables — `SymbolKind` in `symbol.ts`), one
  `FunctionEntity` per function/method/arrow/constructor/getter/setter, one `ClassEntity` per
  class declaration (including its `methods`/`properties`), and `ImportBinding`/`ExportBinding`
  lists per Section 2.
- **Symbol/entity IDs are deterministic**, derived from `(modulePath, kind, name, declaration
  offset)` — not random UUIDs — so re-parsing unchanged content yields identical IDs. This is a
  Phase 1 precedent (`FileId` = relative path, ADR-0005) needed for stable fixture tests today and
  incremental-analysis caching later (Section 29).
- **Syntax-error tolerance** (Section 2): a file that fails to parse produces a `ParseError`
  (`packages/core/src/errors/errors.ts`) surfaced as a `Diagnostic`, and discovery/parsing continues
  for every other file — one malformed file must never abort the whole `index` stage.
- **Wire into a real `ProjectIndexer`**: `packages/parser` exports the pure per-file parse function;
  a small composing `ProjectIndexer` (new, in `packages/parser` or `packages/project-model` — decide
  during implementation, not a Phase 0/1 contract change either way) calls it over every eligible
  file and returns `{ project: <ProjectModel with modules/symbols/functions/classes populated>,
  graphs: {} }` — `graphs` stays empty because module/symbol/call/taint graphs are Phase 3-5.

## Non-goals

- Cross-file import resolution / Module Graph construction (Phase 3).
- Call graph, `EdgeCertainty`, dynamic-dispatch resolution (Phase 4).
- Taint/data-flow tracking (Phase 5).
- Incremental re-parsing (Section 29) — full re-parse of every eligible file each run is acceptable
  for Phase 2; incremental parsing is explicitly called out in `docs/parser/overview.md` as a
  Phase-2-must-decide item, but "must decide" means "decide whether to build it now," and the
  decision here is: not yet, cache-keyed incremental parsing waits for the Section 29 cache design.
- Tree-sitter integration for any language.
- YAML/SQL/Dockerfile parsing — those remain `language` tags from Phase 1 with no semantic model;
  nothing in Section 2's pipeline asks for a Symbol/Module model for non-JS/TS languages yet.
- Type-checking-derived inference beyond what's needed for `typeText`/`returnTypeText` display
  strings (e.g. no full type graph, no generic instantiation resolution).

## Dependencies

Phase 1 (`ProjectModel.files` populated with real `language`/`classification` per file) — this task
cannot start meaningfully until Phase 1 is reviewed and signed off, since it consumes Phase 1's
output as input.

## Files / packages affected

`packages/parser/src/**` (currently empty stub). Possibly `packages/project-model/src/**` if the
composing `ProjectIndexer` lands there instead (decide and record in the implementation ADR).

## Interface changes

None expected to `Module`/`Symbol`/`FunctionEntity`/`ClassEntity`/`ImportBinding`/`ExportBinding` —
Phase 0 already froze these shapes (`docs/domain-model/overview.md`). If implementation finds a
field genuinely missing (e.g. JSX-specific metadata), that's a core-contract change and needs an
ADR + the architect's review before landing, per `CLAUDE.md`/Section 46 — don't smuggle a shape
change in through the parser package.

## Implementation requirements

- No execution of scanned repository code (Section 31) — the TypeScript compiler API is used only
  for parsing/binding (`ts.createSourceFile`/`ts.createProgram` in syntactic/type-check-light mode),
  never `ts.transpileModule` followed by execution, and never a real `tsc` build of the target repo.
- A parse failure on one file must not throw past the file boundary — caught, converted to
  `ParseError`, recorded as a `Diagnostic`, and parsing continues.
- Deterministic output: parsing the same file content twice produces byte-identical `Module`/
  `Symbol`/`FunctionEntity`/`ClassEntity` structures (same rule Phase 1 applied to file discovery).
- Every produced entity's `SourceLocation`/`SourceRange`/`SourcePosition` must be correct 0-based
  offset/line/column, verified against real fixture source, not just "compiles."

## Tests

`fixtures/parser/basic-constructs/`: `functions.ts` (function declaration + arrow-function `const`
+ an unexported async function), `shapes.ts` (interface, type alias, enum, an abstract base class
with a decorator/readonly/protected property/constructor/method, and a subclass extending +
implementing same-file symbols), `imports-exports.ts` (default/namespace/named/side-effect/dynamic
imports, named/default/re-export exports), `plain.js` (the `allowJs` path, no type annotations),
`malformed.ts` (intentional syntax error). `tests/parser/parse-file.test.ts` (8 tests) asserts exact
`Symbol`/`FunctionEntity`/`ClassEntity`/`ImportBinding`/`ExportBinding` shapes including source
locations, plus a determinism test. `tests/parser/end-to-end.test.ts` (2 tests) runs the real
`parserProjectIndexer` after real Phase 1 discovery through `AnalyzerClient`, with a real `Analyzer`
(`quality/exported-function-count`) reading `context.project.functions`.

## Acceptance criteria

- [x] ADR-0006 written and accepted: TypeScript Compiler API choice, deterministic ID scheme,
      per-file (not cross-file) scope for this phase.
- [x] Parser implemented and exported from `@code-analyzer/parser`
      (`packages/parser/src/parse-file.ts`); produces correct `Module`/`Symbol`/`FunctionEntity`/
      `ClassEntity`/`ImportBinding`/`ExportBinding` for every fixture.
- [x] Malformed-file fixture produces a `ParseError`/`Diagnostic`, not a thrown exception, and every
      other fixture file still parses in the same run (verified both at the `parseFile` unit level
      and through the full end-to-end scan).
- [x] A real `ProjectIndexer` (`parserProjectIndexer`, `packages/parser/src/project-indexer.ts`) is
      wired into `AnalyzerClient` and exercised by an end-to-end test using real Phase 1 discovery
      output as input (not a hand-built `ProjectModel`).
- [x] Determinism test: parsing the same fixture twice yields identical `Symbol`/`FunctionEntity` IDs.
- [x] `pnpm build`, `pnpm typecheck`, `pnpm test` (43/43), `pnpm lint` all pass clean across the
      whole workspace.
- [x] `docs/project-status.md` updated to move this task from "next approved" to "completed".
- [ ] Human review of the implementation (parser choice, ID scheme, fixture coverage, and the
      known `ProjectIndexer.index()` diagnostics-channel gap flagged in
      `packages/parser/src/project-indexer.ts`) before Phase 3 (Graph Foundation) is drafted.
