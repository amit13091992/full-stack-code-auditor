# Project Status

Machine- and human-readable status tracker (Section 49). Agents must read this before starting
substantial work and must not decide unilaterally that the project has advanced to the next phase —
that decision is made by a human and recorded here.

## Current phase

**Phase 3 — Graph Foundation** (Phase 0/1/2 signed off by human, amit13091992@gmail.com; Phase 3
approved by the same)

## Current milestone

Phase 3 deliverable per `docs/tasks/phase-3-graph-foundation.md` is **complete**:
`@code-analyzer/graph` provides a concrete in-process `Graph` (ADR-0003) plus Module Graph
(cross-file `IMPORTS` resolution — what ADR-0006 deferred from Phase 2) and Symbol Graph
(`DECLARES`/`EXTENDS`/`IMPLEMENTS`) builders, wired into a real `graphProjectIndexer` and verified
end-to-end through `AnalyzerClient` with real Phase 1+2 output as input. Awaiting human review
before starting Phase 4.

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
  covers every construct in the task spec plus one intentionally malformed file. Also covers
  **CommonJS** (`require()`/`module.exports`/`exports.foo`, `fixtures/parser/basic-constructs/
  commonjs.js`) — added post-Phase-2 in response to a user question about legacy Node.js support;
  reuses the existing `ImportKind`/`ExportKind` values, no core contract change, and required zero
  changes to `buildModuleGraph` since it's binding-kind-agnostic (proven by
  `fixtures/graph/module-links/commonjs/`). `tests/parser/` now has 15 tests total: 11 unit
  (`parse-file.test.ts`, incl. 2 CommonJS tests), 1 for the file-size DoS mitigation
  (`project-indexer.test.ts`, see technical debt below), and 3 real end-to-end
  (`end-to-end.test.ts`) through `AnalyzerClient` with real `Analyzer`s.
- `@code-analyzer/graph` (Phase 3): `InMemoryGraph` — the concrete `Graph` implementation
  (ADR-0003), adjacency-list-backed, with BFS `findPaths` (all-shortest-paths, cycle-safe within a
  path, respects `maxDepth` in edges). `buildModuleGraph` (`src/module-graph.ts`) resolves Phase
  2's per-file `ImportBinding.specifier`s against the rest of the project — extensionless,
  ESM-style `.js`-pointing-at-`.ts`, directory/`index.*`, and bare `"."`/`".."` relative-directory
  forms all handled (the last one added during graph-engineer review); bare/external and
  genuinely-unresolvable specifiers correctly produce no edge rather than a wrong one.
  `buildSymbolGraph` (`src/symbol-graph.ts`) produces `DECLARES` edges (module → symbol/function/
  class) and `EXTENDS`/`IMPLEMENTS` edges from Phase 2's already-resolved same-file class
  relationships. `graphProjectIndexer` (`src/project-indexer.ts`) composes `parserProjectIndexer`
  then builds both graphs, populating `AnalyzerContext.graphs.moduleGraph`/`.symbolGraph` for the
  first time (Phase 0-2 always left `graphs: {}`). 17 tests across `tests/graph/` (8 graph-
  primitive unit tests incl. `nodeType` query filtering, 7 builder tests against real parsed
  fixtures — including a 3-hop import chain, the `.`/`..` fix's regression test, and a CommonJS
  `require()` resolution test, 1 direct `graphProjectIndexer` unit test with a spied logger, 1 real
  end-to-end test with an `Analyzer` reading `context.graphs.moduleGraph`).
  **Reviewed by architect, graph-engineer, test-engineer, security-engineer, and
  documentation-engineer** — all clean; graph-engineer's one finding (bare `"."`/`".."` specifiers
  misclassified as external) was fixed and pinned with a fixture + test in the same pass.

## In-progress components

None — Phase 1, the CLI & Reporting task, Phase 2, and Phase 3 are all complete, pending human review.

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
- Phase 3 needed **no new ADR** — `Graph`/`GraphAccess`/`EdgeRelationType`/`EdgeCertainty` from
  Phase 0 already fit the Module Graph/Symbol Graph scope exactly, verified before implementation
  started. One inter-package dependency decision was made inline (documented in
  `packages/graph/src/project-indexer.ts`'s doc comment, not a separate ADR since it doesn't
  change any frozen contract): `@code-analyzer/graph` depends on `@code-analyzer/parser` directly
  (not just `core`) so its composing `ProjectIndexer` can run real parsing before building graphs
  over the result — a non-cyclic, ADR-0001-compatible edge (`parser` does not depend on `graph`).

## Known technical debt

- Stub packages (`analyzers`, `engines`, `integrations`, `ai`, `plugins`) still contain only
  `package.json` + empty `src/index.ts` — intentional, gated on their own phase. (`parser`, `graph`,
  and `cli` are no longer stubs.)
- **Non-JS/TS languages have no semantic model at all** — only `javascript`/`typescript`/`json`/
  `yaml`/`sql`/`dockerfile` are recognized `LanguageId`s (Section 5's initial scope). A Python-,
  Go-, Java-, Ruby-, or Rust-based repository (most AI/ML codebases included) gets basic file
  discovery/classification only — every source file is tagged `language: "unknown"`, with zero
  parsing, zero Module/Symbol Graph coverage. Supporting a new language needs a `LanguageId` union
  change (a core contract change — ADR + architect review) plus a real parser for it (Tree-sitter,
  per ADR-0006's documented fallback) — this is phase-sized work, not a quick addition.
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
  `parserProjectIndexer` (Phase 2) or `graphProjectIndexer` (Phase 3) — wiring the CLI to real
  parsing/graph-building was intentionally left out of both phases' scope (belongs to
  `docs/tasks/cli-and-reporting.md` instead); natural small follow-up, now with two real indexers
  to choose from.
- `ClassEntity.extendsSymbolId`/`.implementsSymbolIds` (Phase 2, carried into the Symbol Graph's
  `EXTENDS`/`IMPLEMENTS` edges by Phase 3) still only resolve when the base class/interface is
  declared in the *same file* — Phase 3 resolved **import** cross-file references (the Module
  Graph) but did not extend cross-file resolution to class hierarchies; that would need a second
  pass correlating an imported symbol's name against its resolved module's declarations, not yet
  built. Not a bug in either phase — just not yet in scope for either.
- No parameter-property (`constructor(private x: number)`) → `ClassProperty` support — such a
  parameter is only visible via the constructor's `FunctionEntity.parameters`, not as a class
  property. Not in Phase 2's stated scope; revisit if an analyzer needs it.
- Module Graph has no `node_modules`/external-package resolution (Phase 3, intentional non-goal) —
  a bare specifier like `"react"` produces no `IMPORTS` edge at all, not an edge to an "external"
  placeholder node. Revisit only once Section 13's `Dependency[]` actually exists (still deferred,
  ADR-0005) — an external-package node without dependency data behind it wouldn't be very useful.
- No `REFERENCES` edges in the Symbol Graph — Phase 2 never collected `SymbolReference` occurrences
  (only declarations), so there's nothing for Phase 3 to build a graph over yet. `EdgeRelationType`
  already has `REFERENCES` in its Phase 0 union; populating it needs its own small parser-side task.
- No Dependency Graph (`DEPENDS_ON` edges) — same root cause as the `node_modules` gap above:
  `ProjectModel.dependencies` doesn't exist yet (ADR-0005).
- No graph persistence/serialization for incremental-analysis caching (Section 29) — `InMemoryGraph`
  is rebuilt from scratch on every scan; still deferred, same as Phase 1/2's caching gaps.
- **`InMemoryGraph.findPaths` has no size/branching bound** (security-review flagged, not fixed —
  currently unreachable: nothing calls `findPaths` yet, only `addNode`/`addEdge`/`getEdge` via the
  Module/Symbol Graph builders). A densely-connected malicious repository could make a future
  `findPaths` call over an untrusted-repo-derived graph expensive in time and memory. Track this:
  add an explicit node/edge/queue-size cap (or a documented max on `nodeCount`/`edgeCount`) before
  any Phase 4+ analyzer actually calls `findPaths` — the right bound is that analyzer's call to
  make, not something to guess at speculatively now (Section 4/35.7).

Phase 1 (`docs/tasks/phase-1-repository-discovery.md`), the CLI & Reporting task
(`docs/tasks/cli-and-reporting.md`, ADR-0007), Phase 2
(`docs/tasks/phase-2-ast-semantic-model.md`, ADR-0006), and Phase 3
(`docs/tasks/phase-3-graph-foundation.md`) are all **implemented and tested** — all pending human
review before: Phase 4 (Call Graph) is drafted for approval, the CLI is wired into any CI/CD
adapter or published to npm, and the `ProjectIndexer` diagnostics-channel gap (ADR-0008, flagged
during Phase 2 review) is decided on — ideally before Phase 4 adds a third real `ProjectIndexer`-
composing package.
