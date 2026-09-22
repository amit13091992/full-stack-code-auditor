# Project Status

Machine- and human-readable status tracker (Section 49). Agents must read this before starting
substantial work and must not decide unilaterally that the project has advanced to the next phase —
that decision is made by a human and recorded here.

## Current phase

**Phase 4 — Call Graph** (started 2026-09-21, human go-ahead: "yes, go ahead and start Phase 4",
amit13091992@gmail.com) is **closed out** (finalization confirmed by the same human 2026-09-21,
after reviewing the two implementation-time design flags below). Phase 0/1/2/3 were signed off
previously. See `docs/tasks/phase-4-call-graph.md` for the task scope — all 9 checklist steps are
complete: `AnalyzerContext.graphs.callGraph` was already additive (no ADR needed), parser-side
call-site extraction, `buildCallGraph` and its `graphProjectIndexer` wiring, fixtures, unit tests,
an end-to-end test, and a clean `pnpm build`/`typecheck`/`test`/`lint` (149/149 passing).

**Phase 5 — Taint Graph** (go-ahead: "record the go-ahead and start the EdgeRelationType ADR",
amit13091992@gmail.com, 2026-09-22; closed out: "close out phase 5", same human, 2026-09-22) is
**closed out**. See `docs/tasks/phase-5-taint-graph.md` for the task scope — checklist steps 1-9 are
complete: ADR-0014 accepted (`EdgeRelationType` gains `"FLOWS_TO"`; `DataFlow[]` derived on demand,
no new `AnalyzerContext` field), the fixed source/sink/sanitizer signature table
(`packages/graph/src/taint-signatures.ts`), `buildTaintGraph` (`packages/graph/src/taint-graph.ts`)
reusing the Call Graph's `CALLS` edges/`findPaths` for reachability and certainty, its
`graphProjectIndexer` wiring (`AnalyzerContext.graphs.taintGraph` now populated), fixtures under
`fixtures/graph/taint-links/`, unit tests, an end-to-end test through a real `AnalyzerClient`, and a
clean `pnpm build`/`typecheck`/`test`/`lint` (175/175 passing).

**Checklist step 11 — the first real `security/*` rule (e.g. SQL/command injection) — is
explicitly out of scope for this closure.** It is a separate task gated on Section 47's full
enhanced review path (implementation → unit tests → security fixtures → regression tests →
architecture review → security review) and has not been started. Phase 5 as closed here delivers
the Taint Graph plumbing only, same precedent as Phase 4 closing before any analyzer consumed
`callGraph`.

**Design decisions confirmed at Phase 4 close-out** (both flagged by the implementing agents as
worth a second look, both accepted as-is, no rework needed):
- **Nested-function tracking in the parser** (`packages/parser/src/parse-file.ts`): extraction now
  creates a `FunctionEntity` for locally-declared/assigned functions and arrows, not just top-level
  declarations and class methods — needed so a nested-body call site attributes to the nested
  function it's actually in, not the enclosing one. This is a real widening of Phase 2's original
  scope, kept deliberately narrow (enough identity/shape to host `CallSite`s and be a Call Graph
  node, not full parity with top-level `FunctionEntity` fidelity).
- **Callback-argument edges are additive, not exclusive**: a call like `array.map(fn)` gets both its
  own resolved/dynamic `CALLS` edge *and* a separate `"unknown"` edge to the callback's own
  `FunctionEntity`, representing reachability without claiming to know when/how the callback is
  invoked. The task doc's "exactly one edge per call site" wording is satisfied in spirit (no call
  site is left with zero edges) even though this one case produces two.

## Current milestone

Phase 3 deliverable per `docs/tasks/phase-3-graph-foundation.md` is **complete and reviewed** —
architect, graph-engineer, test-engineer, security-engineer, and documentation-engineer review all
landed clean (see the Phase 3 entry under Completed components). `@code-analyzer/graph` provides a
concrete in-process `Graph` (ADR-0003) plus Module Graph (cross-file `IMPORTS` resolution — what
ADR-0006 deferred from Phase 2) and Symbol Graph (`DECLARES`/`EXTENDS`/`IMPLEMENTS`) builders,
wired into a real `graphProjectIndexer` and verified end-to-end through `AnalyzerClient` with real
Phase 1+2 output as input. Phase 3 is fully closed out.

Phase 4 (Call Graph): `buildCallGraph` (`packages/graph/src/call-graph.ts`) resolves `CallSite`s
(recorded by the parser step) into `CALLS` edges reusing Symbol Graph's function/class/symbol node
ids, wired into `graphProjectIndexer` (`AnalyzerContext.graphs.callGraph` now populated). Same-file
identifier/`this.`-method calls resolve `"direct"`; cross-file calls resolved via Module Graph's
import resolution resolve `"resolved"`; a resolved-but-unpinned cross-file re-export lands
`"unknown"` on the target module node; variable computed-member calls (`obj[x]()`) are always
`"dynamic"`; literal computed-member calls resolve like `.member` calls; `.call`/`.apply`/`.bind`
resolve normally when the pre-dispatch expression is itself statically resolvable, else `"dynamic"`;
cross-file `EXTENDS` chains (Phase 3's same-file-only inheritance gap) resolve no better than
`"unknown"`; a callback passed as an argument gets an *additional* `"unknown"` edge to its own
nested `FunctionEntity` (does not replace or downgrade the call's own resolution) representing
reachability without claiming to know when/how it's invoked. Every call site produces at least one
`CALLS` edge — a synthetic `call-site` graph node (not a placeholder for anything external) is
created for a call whose target can't be pinned at all, so uncertainty is visible and queryable
rather than silently dropped (ADR-0004); the one true no-edge case remains calls with no
project-internal node to point at at all (bare/external import specifiers, unbound globals like
`console.log`), matching the Module Graph's existing external-package non-goal. Fixtures under
`fixtures/graph/call-links/`, unit tests in `tests/graph/call-graph.test.ts`, and an end-to-end test
in `tests/graph/call-graph-end-to-end.test.ts` cover all of the above. `pnpm build`/`typecheck`/
`test`/`lint` are clean (149 tests passing, up from 142). **Signed off and closed out** (see
Current phase) — full detail also recorded under Completed components below.

**Also added since Phase 3 (ADR-0009, user-requested capability expansion):** Angular/Vue
framework detection, and **Python as a second supported language** — real Tree-sitter-based
parsing (functions, classes, imports) producing the same `Module`/`Symbol`/`FunctionEntity`/
`ClassEntity` shapes as JS/TS, verified end-to-end including the Symbol Graph working over Python
output with zero `packages/graph` changes. The Module Graph does **not** yet resolve Python
imports — confirmed empirically, not assumed; see technical debt below.

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
  wiring helper. 18 tests across `tests/cli/` (exporters incl. an HTML-injection-escaping test,
  scan/export command success and failure paths, argument parsing). Manually verified against the
  built `dist/bin.js` running real scans over `fixtures/project-model/`.
- **`code-analyzer scan` wired to the real indexer** (small follow-up, post-Phase-3): `scan.ts` now
  passes `graphProjectIndexer` (`@code-analyzer/graph`) as its `ProjectIndexer` strategy instead of
  the Phase 0 passthrough stub (`{ project, graphs: {}, diagnostics: [] }`) — `scan` now runs real
  Phase 2 parsing and Phase 3 Module/Symbol Graph construction, not just discovery, and real parse
  diagnostics (ADR-0008) reach the CLI's JSON/SARIF/HTML reports. `@code-analyzer/cli` gained a
  `@code-analyzer/graph` dependency and tsconfig project reference (no cycle: `graph` doesn't depend
  on `cli`). `findings` is still legitimately empty (no analyzers registered — unrelated, tracked
  separately below). Verified with a new `tests/cli/scan-command.test.ts` case asserting a real
  syntax error in a scanned file surfaces in `ScanResult.diagnostics` — something the old stub could
  never produce — plus manual verification against the built `dist/bin.js`.
- **`InMemoryGraph.findPaths` size/branching bound** (security-review follow-up, closes the gap
  flagged during Phase 3 review): a `MAX_FIND_PATHS_FRAMES_EXPANDED = 50_000` stopgap constant
  (`packages/graph/src/in-memory-graph.ts`, same "conservative stopgap, not a tuned value"
  reasoning as `MAX_PARSEABLE_FILE_SIZE_BYTES`) bounds both frames dequeued and frames enqueued, so
  a densely-connected/pathological graph can no longer make `findPaths` do unbounded work — it
  stops and returns whatever shortest paths were already found. Fixing this also exposed and fixed
  a real O(n²) performance bug: the BFS queue used `Array.shift()` (O(n) per dequeue), which made a
  large queue quadratic; replaced with an index-based queue (O(1) amortized dequeue). No
  `Graph`/`findPaths()` signature change — this is an internal implementation bound, not a Section
  37C contract change, so no ADR was needed. Verified with a new regression test
  (`tests/graph/in-memory-graph.test.ts`) building a 44-node layered fully-bipartite graph where an
  unbounded search would need to expand ~6^7 (~280,000) partial paths to prove unreachability — it
  now returns in well under a second instead of hanging or exhausting memory.
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
- **CommonJS support** (`require()`/`module.exports`/`exports.foo`, added post-Phase-3 in response
  to a user capability question): `packages/parser/src/parse-file.ts` now recognizes both module
  systems. No core contract change — reuses existing `ImportKind`/`ExportKind` values. Verified the
  Module Graph resolves `require()` imports with zero changes to `buildModuleGraph`
  (`fixtures/graph/module-links/commonjs/`). Reviewed by parser-engineer (clean, 11 stress-test
  patterns fed through directly, none crashed).
- **Angular/Vue framework detection + Python as a second language** (ADR-0009, user-requested):
  `FrameworkId` gains `"angular"`/`"vue"` (`packages/project-model/src/frameworks.ts` detects
  `@angular/core`/`vue` deps — no parser changes needed, Angular/Vue `.ts`/`.js` already parses as
  plain TS/JS). `LanguageId` gains `"python"`; `.py`/`.pyi` files are classified and pytest's
  `test_*.py`/`*_test.py` convention is recognized (`packages/project-model/src/classify.ts`) —
  fixing this also **fixed a real pre-existing bug**: `requirements.txt` was being classified
  `documentation` (generic `.txt` rule) instead of `config`, because the config-filename check ran
  *after* the extension-based documentation check; reordered so an exact filename match wins.
  `pip`/`poetry` package-manager detection added (`requirements.txt`/`pyproject.toml`). Python
  parsing uses **Tree-sitter** (`tree-sitter` + `tree-sitter-python`, ADR-0006's documented
  fallback for a non-compiler-API language) — `packages/parser/src/python/parse-python-file.ts`
  mirrors the JS/TS parser's scope (top-level functions/classes/imports, deterministic IDs,
  syntax-error tolerance via `hasError`). `parserProjectIndexer` now dispatches by `file.language`.
  Verified end-to-end: real discovery → real Python parsing → real Symbol Graph (`DECLARES` edges
  work over Python output with zero `packages/graph` changes) → a real `Analyzer`
  (`fixtures/project-model/python-flask/`, `tests/graph/python-end-to-end.test.ts`). **The Module
  Graph does not resolve Python imports** — confirmed empirically (0 edges over a Python fixture
  with real imports), not assumed; Python's dotted-module specifiers need their own resolution
  algorithm, documented as a Non-goal in ADR-0009, not silently broken.
  **Reviewed by architect, parser-engineer, security-engineer, and test-engineer** — all clean.
  parser-engineer's one real finding (Tree-sitter's `node.startIndex` is a UTF-16 code-unit offset,
  not a UTF-8 byte offset, when fed a JS string) is now documented with an explicit comment in
  `packages/parser/src/python/location.ts` and pinned with a non-ASCII regression test
  (`fixtures/parser/python-constructs/non-ascii.py`). test-engineer added missing coverage for
  Angular/Vue detection and the three other newly-added `CONFIG_FILENAMES` entries
  (`pyproject.toml`/`setup.cfg`/`pipfile`), none of which had any test before this review round.
- **`ProjectIndexer` diagnostics channel** (ADR-0008, closes a gap flagged in Phase 2/3 review):
  `ProjectIndexer.index()` now returns `diagnostics: readonly Diagnostic[]` alongside `project`/
  `graphs`, reusing the existing `Diagnostic` type (`packages/core/src/errors/errors.ts`) rather
  than introducing a new one. `ScanEngine.scan()` (`packages/core/src/analyzer/engine.ts`) merges
  them into the same `diagnostics` array it already fills from analyzer results, so they reach
  `ScanResult.diagnostics` for the first time. `parserProjectIndexer` collects each file's real
  `ParseError`-derived `Diagnostic`s instead of only logging them, and the file-size-skip case now
  produces a real `FILE_SKIPPED_SIZE_LIMIT` diagnostic. `graphProjectIndexer` forwards them
  unchanged. The CLI's Phase 0 passthrough stub returns `diagnostics: []` (correct — it has nothing
  to report). Verified end-to-end: `tests/parser/project-indexer.test.ts` proves both the size-skip
  and a malformed file produce a real diagnostic (not just a log line), and
  `tests/core/scan-engine.test.ts` proves an indexer's diagnostics reach `ScanResult.diagnostics`
  through the full `ScanEngine` lifecycle.

- **`@code-analyzer/analyzers` — first real analyzers** (`docs/tasks/first-graph-analyzers.md`,
  quick win parallel to Phase 4 scoping, no core contract change, no ADR): three `Analyzer`
  implementations built only on `AnalyzerContext.graphs.moduleGraph` and Phase 1-2 data —
  `architecture/circular-import` (walks `IMPORTS` edges per module, using `graph.findPaths` to find
  a path back to the start node, plus a direct check for a module importing itself; dedupes cycles
  by the sorted set of participating module IDs so each distinct cycle is reported once, severity
  `medium`, confidence `0.9` — deterministic structural fact over resolved edges, not a heuristic),
  `architecture/unresolved-import` (flags an `ImportBinding` with a relative (`./`/`../`) specifier
  that doesn't resolve to any project module — reusing the Module Graph's own relative-resolution
  algorithm locally since the graph doesn't retain which binding produced which edge; a bare
  specifier like `"react"` is never flagged, since the Module Graph doesn't resolve `node_modules`
  by design; severity `medium`, confidence `0.85`), and `quality/unused-export` (flags a module with
  at least one exported `Symbol`/`FunctionEntity`/`ClassEntity` and zero incoming `IMPORTS` edges
  project-wide — module-level only, deliberately can't say which specific export is unused since
  that needs `REFERENCES` edges, Phase 4+; `index.*` files are excluded as likely entry points,
  `package.json` `main`/`module`-based exclusion is a documented known limitation since
  `ProjectModel` doesn't capture that field today; severity `low`, confidence `0.35` — noticeably
  lower than the other two, reflecting how much weaker this signal is). All three: category per the
  task spec (`architecture`/`architecture`/`quality`), `requiresGraphs: ["moduleGraph"]`,
  `status: "detected"` (static-only, never `"confirmed"`), every `Finding` backed by real `Evidence`
  with an honest `SourceLocation` pointing at the actual import/export statement — discovered
  empirically during implementation that `Module.exports` (`ExportBinding[]`) only covers explicit
  `export { x }`/`export default`/re-export forms, not inline `export function`/`export class`
  declarations, so `quality/unused-export` reads `Symbol.exported`/`FunctionEntity.isExported`/
  `ClassEntity.isExported` directly instead, matching the task doc's actual wording. Fixtures under
  `fixtures/architecture/circular-import/`, `fixtures/architecture/unresolved-import/`,
  `fixtures/quality/unused-export/`, each with a `positive/` and `false-positive/` case
  (`unresolved-import`'s cases include a bare `"react"`/`"express"` specifier that must not fire).
  10 new tests across `tests/analyzers/` (2 unit tests per analyzer plus a 2-test real end-to-end
  suite wiring all three through a real `AnalyzerRegistry` and `AnalyzerClient` after real Phase
  1-3 discovery/parsing/graph-building).
- **`code-analyzer scan` registers the built-in analyzers** (small follow-up, closes the loop on the
  entry above): `scan.ts` now calls `registerBuiltinAnalyzers(registry)`
  (`@code-analyzer/analyzers`, `packages/analyzers/src/index.ts`) against its own
  `InMemoryAnalyzerRegistry` before running `AnalyzerClient.scan()` — `scan` no longer always
  reports zero findings; it runs `architecture/circular-import`, `architecture/unresolved-import`,
  and `quality/unused-export` against every scanned repository. This is the CLI *depending on and
  registering* the analyzers package (mirroring how it already depends on `@code-analyzer/graph`),
  not an analyzer wiring itself into the CLI — consistent with the analyzer-development skill's
  registry-based integration pattern. `@code-analyzer/cli` gained an `@code-analyzer/analyzers`
  dependency and tsconfig project reference. Verified with a new `tests/cli/scan-command.test.ts`
  case asserting all three analyzer IDs appear in `scan.analyzersRun` and a real circular-import
  finding is reported for a fixture that has one; the existing "zero findings" test was re-labeled
  (it now documents "this specific fixture is clean," not "no analyzers are registered") rather than
  removed, since it's still valid coverage. Manually verified against the built `dist/bin.js`.

- **Test coverage ingestion & code quality analyzers** (Track A + Track B1 of ADR-0010, post-Phase-3,
  user-requested capability expansion): `CoverageModel`/`FileCoverage`/`CoverageStatus`
  (`packages/core/src/domain/coverage.ts`) plus an optional `AnalyzerContext.coverage`/
  `ScanOptions.coverage` field; LCOV/Istanbul/`coverage-final.json`/coverage.py parsers in
  `@code-analyzer/integrations` (its first real content) mapping report paths to `FileId`s and
  emitting a `COVERAGE_UNMAPPED_FILE` diagnostic (never a silent guess) for paths that don't
  resolve; a file the report never mentions stays absent from `CoverageModel.files` — surfaced as
  `"unknown"`, never defaulted to `"uncovered"` (ADR-0004 discipline, verified by test). Wired into
  the CLI as an explicit opt-in `code-analyzer scan --coverage <path>` flag — never automatic test
  execution (Section 31). Four new quality analyzers registered alongside the existing three
  (`quality/cyclomatic-complexity`, `quality/duplication`, `quality/maintainability-index`,
  `quality/lint-style-rules`), all Phase 2/3-only (`requiresGraphs: []`), each with positive +
  false-positive fixtures under `fixtures/quality/`. `registerBuiltinAnalyzers` now registers 8
  analyzers total. See ADR-0010 and `docs/tasks/security-quality-coverage-modules.md` (Track A/B1
  checked off; Track B2/C/D remain blocked on Phase 4/5). Verified with `pnpm typecheck` (clean
  across all 10 packages) and `pnpm test` (117/117 passing, 28/28 files), including
  `tests/integrations/coverage.test.ts`, `tests/cli/coverage.test.ts`, and one test per new
  quality analyzer.

- **Phase 4 — Call Graph** (`docs/tasks/phase-4-call-graph.md`, human-authorized 2026-09-21,
  closed out 2026-09-21): call-site extraction (`CallSite`, `FunctionEntity.calls`,
  `packages/core/src/domain/function.ts`) walks every function/method body in
  `packages/parser/src/parse-file.ts` (JS/TS only — Python stays out of scope, same reasoning as
  the Module Graph gap) and records callee shape (identifier, member, computed-member with
  static-vs-dynamic key detection, `new`, `.call`/`.apply`/`.bind` with receiver text) plus
  argument shape (count, whether any argument is a function/arrow — the callback-argument case).
  This required tracking nested (non-top-level) functions/arrows as their own `FunctionEntity` for
  the first time, so a nested-body call attributes to the function it's actually in.
  `buildCallGraph` (`packages/graph/src/call-graph.ts`) turns `CallSite`s into `CALLS` edges,
  reusing Symbol Graph's function/class/symbol node ids (no parallel node scheme), wired into
  `graphProjectIndexer` so `AnalyzerContext.graphs.callGraph` is now populated. `EdgeCertainty` per
  ADR-0004: same-file/`this.`-method calls → `"direct"`; cross-file calls resolved via the Module
  Graph's import resolution → `"resolved"`; a resolved-but-unpinned cross-file re-export →
  `"unknown"` on the target module node; variable computed-member calls (`obj[x]()`) → always
  `"dynamic"`; literal computed-member calls (`obj["x"]()`) resolve like `.member` calls;
  `.call`/`.apply`/`.bind` resolve normally only if the pre-dispatch receiver is itself statically
  resolvable, else `"dynamic"`; a `this.method()` reachable only through a cross-file `extends`
  chain (Phase 3's same-file-only inheritance gap) → `"inferred"` at best, `"unknown"` if
  unresolvable at all. Every call site produces at least one `CALLS` edge — an unresolvable-but-real
  call gets a synthetic `call-site` node rather than being silently dropped; the only true no-edge
  case is a call into an external package/unbound global (e.g. `console.log()`), matching the
  Module Graph's existing external-package non-goal. A callback passed as an argument
  (`array.map(fn)`) gets an *additional* `"unknown"` edge to the callback's own `FunctionEntity`,
  alongside (not replacing) the call's own resolution — a deliberate two-edges-per-call-site
  exception, confirmed acceptable at close-out. Fixtures under `fixtures/graph/call-links/`, unit
  tests in `tests/graph/call-graph.test.ts` (per-EdgeCertainty-category assertions, not just edge
  existence), and an end-to-end test in `tests/graph/call-graph-end-to-end.test.ts` through a real
  `AnalyzerClient`. `pnpm build`/`typecheck`/`test`/`lint` clean, 149/149 tests passing (up from
  117). Phase 5 (Taint Graph) remains undrafted, per this file's phase-advancement rule.

- **Phase 5 — Taint Graph** (`docs/tasks/phase-5-taint-graph.md`, ADR-0014): `EdgeRelationType`
  gains `"FLOWS_TO"`; a fixed, named source/sink/sanitizer signature table
  (`packages/graph/src/taint-signatures.ts`) matches recognized `CallSite` shapes (`process.env`,
  `req.query`/`params`/`body`/`headers`/`cookies`, `fs.readFile*` as sources; `eval`,
  `child_process.exec`/`execSync`, a db-client `.query(...)`, a template `.render(...)` as sinks;
  `escapeHtml`/`parseInt`/`mysql.escape` as sanitizers); `buildTaintGraph`
  (`packages/graph/src/taint-graph.ts`) reconstructs argument-position source→sink flows by reusing
  the Call Graph's `CALLS` edges and `findPaths` (no new resolution logic), marking a flow
  `sanitized: true` when a recognized sanitizer sits on the path and setting `certainty` to the
  weakest `CALLS` edge certainty along it — an unresolved/dynamic path still produces a `FLOWS_TO`
  edge with reduced certainty rather than being dropped (ADR-0004). Wired into `graphProjectIndexer`,
  populating `AnalyzerContext.graphs.taintGraph` for the first time. Fixtures under
  `fixtures/graph/taint-links/` (unsanitized flow, sanitized flow, flow through an unknown `CALLS`
  edge, a safe-sink false-positive case, a no-source/no-sink case), unit tests running the real
  parser → Call Graph → Taint Graph pipeline over each fixture, and an end-to-end test through a
  real `AnalyzerClient` with a placeholder analyzer that only reports the `FLOWS_TO` edge count (no
  vulnerability judgment). `pnpm build`/`typecheck`/`test`/`lint` clean, 175/175 tests passing (up
  from 169). **No `security/*` rule was implemented** — that is explicitly out of scope for this
  phase's closure, gated on Section 47's full review path, and is the next separate task.

- **`ScanProfile` now actually filters which analyzers run** (ADR-0013, user-reported bug fix:
  `--profile minimal` and `--profile full`/`enterprise` gave byte-identical results because
  `ScanEngine.scan()`'s analyzer-selection branch ran `this.registry.list()` unconditionally
  whenever no explicit `analyzers` id list was given — `profile` was stored on the result but never
  used to select analyzers). `packages/core/src/analyzer/profiles.ts` adds `PROFILE_CATEGORIES`
  (profile -> `AnalyzerCategory[]`); `ScanEngine.scan()` now filters `registry.list()` by it unless
  an explicit `analyzers` id list is supplied (which still bypasses profile filtering entirely,
  unchanged). No `ScanProfile`/`AnalyzerCategory`/`AnalyzerConfig`/`ScanOptions` shape change.
  `packages/cli` and `packages/api` needed no wiring change (both already just pass `profile`
  through), but `packages/api/src/scan/run-scan.ts`'s hardcoded `profile: "minimal"` was bumped to
  `"full"` — it takes no profile from the request yet, and "minimal" would have silently dropped
  it to architecture-only analyzers, breaking its own existing secrets-detection tests. Five new
  tests in `tests/core/scan-engine.test.ts` cover each profile's actual category set plus the
  explicit-analyzers bypass; three pre-existing tests whose fixture analyzers were `quality`-
  category under a `minimal`/hardcoded config were updated to a profile that actually covers
  `quality` (`standard`/`full`), since they were unintentionally relying on the bug being fixed
  here. `pnpm build`/`typecheck`/`test`/`lint` clean (154/154 tests, up from 149).

- **`codegraph-scan scan` (no `--profile` flag) now defaults to `standard`, not `minimal`**
  (follow-up to ADR-0013, user-reported). Once profile filtering above actually took effect, the
  CLI's pre-existing `profile ?? "minimal"` default (`packages/cli/src/commands/scan.ts`) silently
  dropped every `quality` finding from a bare `scan .` — a real report went from 1003 findings
  across 292 files to 64 across 60 with no flag change on the caller's part. `standard` (
  `architecture` + `quality`) restores the coverage users of the plain command were already relying
  on; `minimal` (architecture-only) is still available via an explicit `--profile minimal`.

## In-progress components

- **`@code-analyzer/api`** — a new HTTP API package exposing the existing `AnalyzerClient`/
  `ScanEngine` pipeline over HTTP (upload a code archive, run the same wiring
  `@code-analyzer/cli`'s `scan` command uses, return a `ScanResult`, with an SSE-streaming variant
  sourced from `ScanOptions.onEvent`, ADR-0012). Scoped explicitly to a stateless scan
  request/response — no web UI, no mobile app, no persistence/history, no auth, no
  `@code-analyzer/ai` or Phase 4 involvement. `ScanOptions.onEvent` (core, ADR-0012) has landed;
  the package itself is being built incrementally per its task breakdown.

## Blocked components

None.

## Known architectural decisions

- See `docs/decisions/ADR-0001-monorepo-package-architecture.md` through `ADR-0013`.
- `ProjectIndexer.index()` gains a required `diagnostics: readonly Diagnostic[]` field, reusing the
  existing `Diagnostic` type rather than a new one, so parser-stage `ParseError`s and file-size
  skips reach `ScanResult.diagnostics` for the first time instead of only `logger.debug()`:
  ADR-0008.
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
- `LanguageId` gains `"python"`, `FrameworkId` gains `"angular"`/`"vue"`, Python parsing uses
  Tree-sitter (ADR-0006's documented fallback), Python's `ImportKind` mapping (`import`/
  `import ... as` → `"namespace"`, `from ... import` → `"named"`, wildcard → `"namespace"` with
  `localName: "*"`), and `Symbol.exported` for Python being convention-derived (leading
  underscore) rather than keyword-derived: ADR-0009.
- Security/quality/coverage subsystem package placement: no new packages for security or quality
  analyzers (they're ordinary `Analyzer`s in `@code-analyzer/analyzers`, differentiated by
  `category`, not package boundary); coverage gets the one genuinely new `packages/core` domain type
  (`CoverageModel`) because "no data available" can't be represented by any existing contract;
  coverage ingestion lives in `@code-analyzer/integrations` (external-artifact normalization,
  ADR-0007's stated purpose) while correlation analyzers live in `@code-analyzer/analyzers`; security
  SAST rules remain fully gated on Call Graph (Phase 4) + Taint Graph (Phase 5) per
  `docs/security/overview.md`, unchanged: ADR-0010.
- `ScanOptions` gains an optional `onEvent?: ScanEventListener` field so an external caller (today:
  `@code-analyzer/api`'s SSE endpoint) can observe the same `ScanEvent` sequence `AnalyzerContext.events`
  already exposes to analyzers, without changing `scan()`'s return type or `ScanEngine`'s internal
  event model: ADR-0012.

## Known technical debt

- Stub packages (`engines`, `integrations`, `ai`, `plugins`) still contain only `package.json` +
  empty `src/index.ts` — intentional, gated on their own phase. (`parser`, `graph`, `cli`, and now
  `analyzers` are no longer stubs.)
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
- SARIF export is verified by structural assertions against the fields we emit, not full SARIF
  2.1.0 schema validation (ADR-0007) — strengthen before relying on it in a real CI/CD adapter.
- No `--fail-on <severity>` CI-gating exit code on `scan` yet (deferred, cheap follow-up).
- No `explain`/`graph`/`endpoints`/`dependencies` CLI subcommands yet — each needs data from a
  later phase (finding lookup, the graph, the endpoint/dependency models).
- **`quality/cyclomatic-complexity` computes a documented proxy score, not true McCabe complexity**
  (`1 + nestedFunctionCount + floor(lineSpan/10)`, confidence capped at 0.45) — `FunctionEntity`
  retains no AST/branch data today, and `parseFile` doesn't recurse into function bodies to capture
  nested functions, so a real branch-count metric needs a `packages/parser`/`packages/core` change,
  not made here (Section 35.13 — flagged, not built ahead of need). Revisit if/when the parser gains
  per-function branch tracking.
- **`parserProjectIndexer` now skips files over 5 MB** (`MAX_PARSEABLE_FILE_SIZE_BYTES`,
  `packages/parser/src/project-indexer.ts`) rather than parsing them — a security-review-flagged
  fix for Section 31 (repository content is hostile input; an unbounded-size file handed to
  `ts.createSourceFile` risks unbounded memory/CPU), **re-reviewed and confirmed remediated**: the
  check runs before `fs.readFile` (oversized content is never read into memory), `sizeBytes` is a
  trustworthy real `fs.stat` value (not repository-content-controlled), and
  `tests/parser/project-indexer.test.ts` proves it end-to-end with a real >5MB file (generated at
  test time, not committed as a fixture) alongside a normal-sized sibling that still parses
  correctly. The 5 MB threshold itself is still a conservative stopgap, not a tuned value. The skip
  now also surfaces as a real `FILE_SKIPPED_SIZE_LIMIT` `Diagnostic` (ADR-0008) rather than only a
  log line; making the threshold itself configurable via `AnalyzerConfig` remains a separate,
  not-yet-scoped follow-up, so a repo with legitimately huge but wanted source files (rare, e.g. a
  large generated-but-unclassified data fixture) isn't silently blind-spotted forever.
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
- **Python Module Graph resolution doesn't exist** — `buildModuleGraph` produces zero `IMPORTS`
  edges over Python `import`/`from ... import ...` statements (confirmed empirically). Python's
  dotted-module specifiers, `__init__.py` package roots, and `sys.path`-based absolute-import
  resolution are a different algorithm from the JS-specific relative-path resolver; extending it is
  real, separate follow-up work (ADR-0009 Non-goals), not a bug in the current implementation.
- **`.vue` single-file components aren't parsed** — `.vue` files are tagged `language: "unknown"`,
  same as before Angular/Vue detection was added; only Angular/Vue framework *detection* landed,
  not `.vue` SFC `<script>`-block extraction (ADR-0009 Non-goals).
- **No Django/Flask/FastAPI (or any Python) framework detection** — `FrameworkId` has no
  Python-framework values yet; would need parsing `requirements.txt`/`pyproject.toml` dependency
  lists the way `frameworks.ts` already parses `package.json` (ADR-0009 Non-goals).
- **Python: no generator detection, no nested-class/nested-function tracking, no class-body
  property tracking** (Python's assignment-based instance/class attributes have no direct
  `ClassProperty` equivalent extracted yet) — all documented Non-goals in ADR-0009, matching the
  "top-level only" scope discipline Phase 2 already established for JS/TS.
- **Only one non-JS/TS language (Python) is supported** — C#, PHP, Java, Go, Ruby, Rust, etc. have
  no `LanguageId` value and no parser; each would need its own ADR-0009-style addition (a
  `LanguageId` value + a Tree-sitter grammar + a parser module), not a generalized "any language"
  capability. See ADR-0009's Alternatives-considered note on why a generic multi-language
  abstraction wasn't built preemptively with only one Tree-sitter language in the codebase.
- **No per-file parse-time budget/timeout** (either JS/TS or Python) — security review flagged this
  as a pre-existing, language-agnostic gap (not new, not made worse by adding Python): the file-size
  cap (`MAX_PARSEABLE_FILE_SIZE_BYTES`) bounds worst-case input size but there's no hard timeout on
  parse duration itself. Track alongside other Phase 3+ hardening items.
- **No native-dependency supply-chain policy documented** in `docs/security/overview.md` —
  `tree-sitter`/`tree-sitter-python` are the first native (compiled) dependencies in this monorepo;
  ADR-0009 notes they were verified to install/run cleanly here, but there's no stated position on
  prebuilt-binary provenance/checksum trust. Worth formalizing once a second native dependency
  exists (security review's own recommendation — don't build the policy doc prematurely for one
  data point, same anti-speculation reasoning as ADR-0009's Alternatives section).

## Next approved tasks

Phase 1 (`docs/tasks/phase-1-repository-discovery.md`), the CLI & Reporting task
(`docs/tasks/cli-and-reporting.md`, ADR-0007), Phase 2
(`docs/tasks/phase-2-ast-semantic-model.md`, ADR-0006), Phase 3
(`docs/tasks/phase-3-graph-foundation.md`), CommonJS support, Angular/Vue/Python support
(ADR-0009), the `ProjectIndexer` diagnostics channel (ADR-0008), wiring `code-analyzer scan` to the
real `graphProjectIndexer`, the first `@code-analyzer/analyzers` rules
(`docs/tasks/first-graph-analyzers.md`), registering them against `scan`'s own registry, coverage
ingestion + quality analyzers (ADR-0010 Track A/B1), the `@code-analyzer/api` HTTP layer, Phase 4
(`docs/tasks/phase-4-call-graph.md`, Call Graph), and Phase 5 (`docs/tasks/phase-5-taint-graph.md`,
Taint Graph, ADR-0014) are all **implemented and tested**. The first `security/*` rule (SQL
injection, command injection, etc.) built on top of the Taint Graph is **not started** — it needs
its own explicit human go-ahead and follows Section 47's full enhanced review path, same as any
taint-touching change (see Current phase). Also pending human review/decision: the CLI/API being
wired into any CI/CD
adapter or published, and — if desired — Python Module Graph resolution, Python Call Graph, or a
third language, each scoped as their own follow-up tasks.
