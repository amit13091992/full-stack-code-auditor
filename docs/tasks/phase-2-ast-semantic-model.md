# Task: Phase 2 — AST & Semantic Source Model (DRAFT — not approved to start)

> Per `docs/project-status.md`: Phase 1 is implemented and tested but still awaiting human review.
> This draft exists so Phase 2 scope is visible during that review, not as a green light — the
> same gate Phase 1 went through (Section 37: "Do not move into Phase 1 until Phase 0 architecture
> is internally coherent") applies here for Phase 2 against Phase 1.

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

New fixtures under `fixtures/parser/` (not `fixtures/project-model/` — this is Phase 2's own
concern): small hand-written `.ts`/`.tsx`/`.js`/`.jsx` files covering — a plain function
declaration, an arrow function assigned to a `const`, a class with a constructor/method/property/
decorator, an interface, a type alias, an enum, named/default/namespace/dynamic/re-export imports
and exports, and one intentionally-malformed file to exercise `ParseError` tolerance. Assert the
exact `Symbol`/`FunctionEntity`/`ClassEntity`/`ImportBinding`/`ExportBinding` shape produced,
including source locations. Add an end-to-end test (Phase 1's `end-to-end.test.ts` pattern) running
the real `ProjectIndexer` after real discovery through `AnalyzerClient`, with a real `Analyzer`
asserting on `context.project.modules`/`.symbols`/`.functions`/`.classes`.

## Acceptance criteria

- [ ] ADR-0006 written and accepted: TypeScript Compiler API choice, deterministic ID scheme,
      per-file (not cross-file) scope for this phase.
- [ ] Parser implemented and exported from `@code-analyzer/parser`; produces correct `Module`/
      `Symbol`/`FunctionEntity`/`ClassEntity`/`ImportBinding`/`ExportBinding` for every fixture.
- [ ] Malformed-file fixture produces a `ParseError`/`Diagnostic`, not a thrown exception, and every
      other fixture file still parses in the same run.
- [ ] A real `ProjectIndexer` is wired into `AnalyzerClient` and exercised by an end-to-end test
      using real Phase 1 discovery output as input (not a hand-built `ProjectModel`).
- [ ] Determinism test: parsing the same fixture twice yields identical output.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint` all pass clean across the whole
      workspace.
- [ ] `docs/project-status.md` updated to move this task from "next approved" to "completed".
- [ ] Human review of the implementation (parser choice, ID scheme, fixture coverage) before Phase 3
      (Graph Foundation) is drafted for approval.
