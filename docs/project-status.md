# Project Status

Machine- and human-readable status tracker (Section 49). Agents must read this before starting
substantial work and must not decide unilaterally that the project has advanced to the next phase —
that decision is made by a human and recorded here.

## Current phase

**Phase 2 — AST & Semantic Source Model** (Phase 0 and Phase 1 signed off by human,
amit13091992@gmail.com; ADR-0006 and Phase 2 implementation approved by the same)

## Current milestone

Phase 2 deliverable per `docs/tasks/phase-2-ast-semantic-model.md` is **complete**:
`@code-analyzer/parser` parses every eligible JS/TS file via the TypeScript Compiler API
(ADR-0006) into `Module`/`Symbol`/`FunctionEntity`/`ClassEntity`, wired into a real
`parserProjectIndexer` and verified end-to-end through the real `ScanEngine`/`AnalyzerClient`
lifecycle with real Phase 1 discovery as input. Awaiting human review before starting Phase 3.

## Completed components

- Monorepo scaffold: pnpm workspaces, `tsconfig.base.json`, 10 package boundaries created (`core`,
  `project-model`, `parser`, `graph`, `analyzers`, `engines`, `integrations`, `ai`, `plugins`, `cli`).
- `@code-analyzer/core` domain model: `Project`, `Repository`, `File`, `Module`, `Symbol`, `Function`,
  `Class`, `Dependency`, `Endpoint`, `DatabaseEntity`, `Service`, `SecurityBoundary`, `DataFlow`,
  `Evidence`, `Finding`, `Scan` — see `packages/core/src/domain/`.
- Core contracts: `Analyzer`, `AnalyzerContext`, `AnalysisResult`, `Graph`, `AnalyzerPlugin`,
  `ScanOptions`, `ScanResult`, `AnalyzerConfig` — see `packages/core/src/`.
- `ScanEngine` / `AnalyzerClient`: a working (not stubbed-out) orchestrator implementing the
  initialize → discover → index → analyze → correlate → finalize lifecycle, driven by pluggable
  `RepositoryDiscoverer` / `ProjectIndexer` / `FindingCorrelator` / `RiskCalculator` strategies.
  Covered by `tests/core/scan-engine.test.ts` (3 passing tests) using fixture strategies — no real
  discovery/parsing exists yet, which is correct for Phase 0.
- Event model (`ScanEvent` union), error/diagnostic model, structured logging contract.
- ADRs: see `docs/decisions/`.
- `.claude/` development-agent configuration: `CLAUDE.md`, agents, skills, commands.
- `RepositoryDiscoverer` (`@code-analyzer/project-model`, Phase 1): filesystem walk with
  `.gitignore` handling (`src/walk.ts`), file classification into `SourceClassification`/
  `LanguageId` (`src/classify.ts`), binary detection (`src/binary.ts`), content hashing
  (`src/hash.ts`), package-manager + pnpm/npm/yarn workspace detection (`src/package-manager.ts`),
  and framework detection for Section 5's initial list (`src/frameworks.ts`). Wired together in
  `src/discover.ts` as `projectModelDiscoverer`, exported from the package's `index.ts`.
  See ADR-0005.
- 6 fixture repositories under `fixtures/project-model/` (node-express/npm, nestjs-app/pnpm,
  nextjs-app/yarn, react-native-app/bun, monorepo-pnpm with 2 workspace packages, generated-code
  exercising every `SourceClassification`) with 9 passing tests: 6 fixture-classification tests
  plus a determinism test (`tests/project-model/discover.test.ts`), and 2 true end-to-end tests
  running real discovery through the actual `AnalyzerClient.scan()` lifecycle with a real
  `Analyzer` reading `context.project.files` (`tests/project-model/end-to-end.test.ts`).
- CLI & reporting (`docs/tasks/cli-and-reporting.md`, ADR-0007): `json`/`sarif`/`html`
  `ResultExporter` implementations in `@code-analyzer/cli/src/exporters/`; `code-analyzer scan
  <root>` (real Phase 1 discovery → whatever analyzers are registered, zero today) and
  `code-analyzer export` (re-format a prior `ScanResult`) commands with a hand-rolled argument
  parser (`src/args.ts`) and a `bin` entry point (`src/bin.ts`); an `InMemoryAnalyzerRegistry`
  wiring helper. 17 tests across `tests/cli/` (exporters incl. an HTML-injection-escaping test,
  scan/export command success and failure paths, argument parsing). Manually verified against the
  built `dist/bin.js` running real scans over `fixtures/project-model/`.
- `@code-analyzer/parser` (Phase 2, ADR-0006): `parseFile` — per-file TypeScript Compiler API
  parsing (`allowJs: true`, both `.js`/`.jsx` and `.ts`/`.tsx`) into `Module`/`Symbol`/
  `FunctionEntity`/`ClassEntity`/`ImportBinding`/`ExportBinding`, with deterministic
  `(modulePath, kind, name, offset)`-derived IDs (`src/ids.ts`), 0-based `SourceLocation` mapping
  (`src/location.ts`), and syntax-error tolerance via `ParseError`/`Diagnostic` (never throws past
  a file boundary). `parserProjectIndexer` (`src/project-indexer.ts`) wires it into a real
  `ProjectIndexer`, parsing every file whose `language` is `javascript`/`typescript` and
  `classification` is not `generated`/`vendored`/`asset`. `fixtures/parser/basic-constructs/`
  covers every construct in the task spec plus one intentionally malformed file. 10 tests across
  `tests/parser/` (8 unit, 2 real end-to-end through `AnalyzerClient` with a real `Analyzer`
  reading `context.project.functions`).

## In-progress components

None — Phase 1, the CLI & Reporting task, and Phase 2 are all complete, pending human review.

## Blocked components

None.

## Known architectural decisions

- See `docs/decisions/ADR-0001-monorepo-package-architecture.md` through `ADR-0007`.
- Notably: the `Analyzer` name collision between the Section 37C rule contract and the Section 3
  facade class is resolved by naming the facade `AnalyzerClient` (ADR-0002).
- Repository discovery implementation choices (symlinks never followed, classification priority
  order, minimal workspace-glob support, `FileId` = relative path, no YAML dependency for
  `pnpm-workspace.yaml`): ADR-0005.
- CLI reporting exporters live in `@code-analyzer/cli` (not `@code-analyzer/integrations`, which is
  reserved for ingesting external tool output — the opposite direction); no CLI framework
  dependency yet: ADR-0007.
- Parser: TypeScript Compiler API (not Tree-sitter) for JS/TS, deterministic entity IDs, per-file
  (not cross-file) scope this phase: ADR-0006.

## Known technical debt

- Stub packages (`graph`, `analyzers`, `engines`, `integrations`, `ai`, `plugins`) still contain
  only `package.json` + empty `src/index.ts` — intentional, gated on their own phase.
  (`parser` and `cli` are no longer stubs.)
- Workspace glob expansion only supports an exact path or a trailing `/*` — no `**`/brace patterns
  (ADR-0005). Revisit against a real fixture that needs it.
- No persistent cache/incremental-analysis implementation yet (`IncrementalConfig` is a contract
  only) — Section 29 work, not required by the Phase 1 task spec.
- Reasoning provider abstraction (`ReasoningProviderConfig`) has no concrete provider yet — planned
  for `packages/ai` once deterministic analyzers exist to feed it (Section 24).
- Discovery does not yet populate `ProjectModel.dependencies` (Section 13's `Dependency[]`) —
  deliberately deferred per ADR-0005 until vulnerability/reachability data sources exist.
- `code-analyzer scan` legitimately produces zero findings today — `@code-analyzer/analyzers` has
  no analyzers registered yet (intentional per `docs/tasks/cli-and-reporting.md` Non-goals).
- SARIF export is verified by structural assertions against the fields we emit, not full SARIF
  2.1.0 schema validation (ADR-0007) — strengthen before relying on it in a real CI/CD adapter.
- No `--fail-on <severity>` CI-gating exit code on `scan` yet (deferred, cheap follow-up).
- No `explain`/`graph`/`endpoints`/`dependencies` CLI subcommands yet — each needs data from a
  later phase (finding lookup, the graph, the endpoint/dependency models).
- **`ProjectIndexer.index()` has no diagnostics return channel** (`packages/core/src/analyzer/
  pipeline.ts`) — `parserProjectIndexer` can only `logger.debug()` a file's `ParseError`s (and now
  its size-skip decisions, see below), they never reach `ScanResult.diagnostics`. Architect review
  (see `docs/decisions/`, pending ADR-0008) recommends this land as a small core-contract change +
  ADR at the start of Phase 3 work, before more `ProjectIndexer`-adjacent consumers exist — not a
  blocker to Phase 2 sign-off itself.
- **`parserProjectIndexer` now skips files over 5 MB** (`MAX_PARSEABLE_FILE_SIZE_BYTES`,
  `packages/parser/src/project-indexer.ts`) rather than parsing them — a security-review-flagged
  fix for Section 31 (repository content is hostile input; an unbounded-size file handed to
  `ts.createSourceFile` risks unbounded memory/CPU), **re-reviewed and confirmed remediated**: the
  check runs before `fs.readFile` (oversized content is never read into memory), `sizeBytes` is a
  trustworthy real `fs.stat` value (not repository-content-controlled), and
  `tests/parser/project-indexer.test.ts` proves it end-to-end with a real >5MB file (generated at
  test time, not committed as a fixture) alongside a normal-sized sibling that still parses
  correctly. The 5 MB threshold itself is still a conservative stopgap, not a tuned value — the
  follow-up review noted two non-blocking future improvements: surfacing the skip as a visible
  `Diagnostic` once ADR-0008 exists, and potentially making the threshold configurable via
  `AnalyzerConfig` in a later phase, so a repo with legitimately huge but wanted source files (rare,
  e.g. a large generated-but-unclassified data fixture) isn't silently blind-spotted forever.
- `code-analyzer scan`'s indexer is still the Phase 0 passthrough stub, not the real
  `parserProjectIndexer` from Phase 2 — wiring the CLI to real parsing was intentionally left out of
  Phase 2's scope (belongs to `docs/tasks/cli-and-reporting.md` instead); natural small follow-up.
- Parser scope is per-file only (ADR-0006): `extendsSymbolId`/`implementsSymbolIds` only resolve
  when the base class/interface is declared in the *same* file; cross-file resolution is Phase 3's
  Module/Symbol Graph job, not a parser bug.
- No parameter-property (`constructor(private x: number)`) → `ClassProperty` support — such a
  parameter is only visible via the constructor's `FunctionEntity.parameters`, not as a class
  property. Not in Phase 2's stated scope; revisit if an analyzer needs it.

## Next approved tasks

Phase 1 (`docs/tasks/phase-1-repository-discovery.md`), the CLI & Reporting task
(`docs/tasks/cli-and-reporting.md`, ADR-0007), and Phase 2
(`docs/tasks/phase-2-ast-semantic-model.md`, ADR-0006) are all **implemented and tested** — all
pending human review before: Phase 3 (Graph Foundation) is drafted for approval, the CLI is wired
into any CI/CD adapter or published to npm, and (for Phase 2 specifically) the `ProjectIndexer`
diagnostics-channel gap noted above is decided on.
