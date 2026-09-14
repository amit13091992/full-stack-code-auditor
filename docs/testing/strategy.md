# Testing Strategy

Section 30/51: test fixtures are first-class from the beginning; a task is not "done" because it
compiles.

## Layout

```
tests/                    unit + integration tests, mirrors packages/*/src structure
  core/
    scan-engine.test.ts    lifecycle contract tests (Phase 0)
  project-model/
    discover.test.ts       classification/detection/determinism tests (Phase 1)
    end-to-end.test.ts     real discovery through the actual AnalyzerClient lifecycle (Phase 1)
    package-manager.test.ts  package-manager/workspace-glob unit tests
  cli/
    args.test.ts           argument-parsing tests (CLI & Reporting task)
    exporters.test.ts      json/sarif/html ResultExporter tests, incl. HTML-injection escaping
    scan-command.test.ts   `scan` command success/failure paths
    export-command.test.ts `export` command success/failure paths
  parser/
    parse-file.test.ts     per-file parse unit tests (Phase 2): symbols/functions/classes/
                            imports/exports, determinism, malformed-file tolerance
    project-indexer.test.ts  file-size DoS-mitigation regression test (Phase 2, security-review follow-up)
    end-to-end.test.ts     real discovery -> real parsing through AnalyzerClient (Phase 2)
  graph/
    in-memory-graph.test.ts  Graph primitive unit tests (Phase 3): add/lookup, findPaths, cycles
    builders.test.ts       Module Graph / Symbol Graph builder tests against real parsed fixtures
    end-to-end.test.ts     real discovery -> parsing -> graph-building through AnalyzerClient (Phase 3)
fixtures/                 input repositories + expected-output fixtures (Section 30)
  project-model/          Phase 1 repository-discovery fixtures (see below)
  parser/                 Phase 2 parser fixtures (see below)
  graph/                  Phase 3 graph fixtures (see below)
  security/
    sql-injection/
    ssrf/
    idor/
    xss/
    auth-bypass/
    path-traversal/
  architecture/
  performance/
  react/
  react-native/
examples/                 example repositories used in docs/demos, not asserted against in CI
```

`fixtures/security/*`, `fixtures/architecture/*`, `fixtures/performance/*` are still empty —
populated starting Phase 5 (taint engine) and Section 7 (security analyzers), once there is a real
analyzer to assert findings against. Each fixture package, when added, must define: source project,
expected findings, expected paths, expected severity, expected confidence range (Section 30) — and
a matching **false-positive** fixture (Section 30: "as important as vulnerability fixtures").

`fixtures/project-model/` (Phase 1) is populated: `node-express` (npm), `nestjs-app` (pnpm),
`nextjs-app` (yarn), `react-native-app` (bun), `monorepo-pnpm` (2 workspace packages),
`monorepo-pnpm-gaps` (a `pnpm-workspace.yaml` with a comment and a blank line inside the
`packages:` list — regression fixture), `no-manifest` (no `package.json`/lockfile at all), and
`generated-code` (exercises every `SourceClassification` — generated, vendored, infrastructure,
test, documentation, asset, config, source, unknown). These aren't security fixtures, so they define
expected classification/framework/package-manager output rather than expected findings.

`fixtures/parser/basic-constructs/` (Phase 2) is populated: `functions.ts` (function declaration +
arrow function), `shapes.ts` (interface, type alias, enum, decorated/inherited classes, multiple
`implements` clauses, static members, getter/setter accessors, a non-exported class),
`imports-exports.ts` (every import/export kind), `plain.js` (the `allowJs` path), `malformed.ts`
(intentional syntax error for `ParseError` tolerance), `component.tsx` (JSX/TSX `ScriptKind` path),
`data.json` (a non-JS/TS file exercising `parserProjectIndexer`'s language-skip branch).

`fixtures/graph/module-links/` (Phase 3) is populated: `main.ts` (imports `./math.js` extensionless-
`.ts`-via-`.js`-specifier, `./utils` as a directory/`index.ts` import, the bare specifier
`"left-pad"`, and the unresolvable relative specifier `"./does-not-exist.js"` — covering every
Module Graph resolution case in one file), `math.ts`, `utils/index.ts`. `chain-a.ts`/`chain-b.ts`/
`chain-c.ts` prove multi-hop (A→B→C) resolution, not just a single hop. `pkg/index.ts`/
`pkg/user.ts`/`pkg/nested/child.ts` pin the bare `"."`/`".."` relative-directory-import forms
(added during graph-engineer review — these don't start with `"./"`/`"../"` but are still relative,
not external, imports). The Symbol Graph's `EXTENDS`/`IMPLEMENTS` tests reuse
`fixtures/parser/basic-constructs/shapes.ts` rather than duplicating a class-hierarchy fixture.

## What Phase 0 tests

`tests/core/scan-engine.test.ts` exercises `AnalyzerClient`/`ScanEngine` end-to-end using fixture
`RepositoryDiscoverer`/`ProjectIndexer`/`Analyzer` implementations defined inline in the test — not
real discovery or parsing. It asserts:

1. The full stage sequence runs and produces a schema-versioned `ScanResult`.
2. `Analyzer.supports()` returning `false` correctly excludes an analyzer from the run.
3. Optional `FindingCorrelator`/`RiskCalculator` strategies are applied when configured, and are
   skipped without error when absent.

This is the acceptance test for the Section 37D lifecycle contract — any future change to
`ScanEngine`'s stage order or event sequence must keep this test (or its direct successor) green.

## What Phase 1 tests

`tests/project-model/discover.test.ts` runs `projectModelDiscoverer.discover()` against each fixture
under `fixtures/project-model/` and asserts package-manager detection, workspace-package resolution,
framework detection, and per-file `language`/`classification`/`encoding`, plus a determinism test
(two discovery runs over the same fixture produce identical file lists and content hashes — required
for future incremental-analysis caching, Section 29).

`tests/project-model/end-to-end.test.ts` is the first *real* end-to-end test (as opposed to Phase
0's fixture-strategy test): it wires `projectModelDiscoverer` into a real `AnalyzerClient`, with a
real `Analyzer` that reads `context.project.files` and emits findings for every `generated`-
classified file — proving the full `discover → index → analyze → correlate → finalize` pipeline
works end-to-end with actual filesystem discovery, not a fixture double.

## What Phase 2 tests

`tests/parser/parse-file.test.ts` runs `parseFile()` against each fixture under
`fixtures/parser/basic-constructs/` and asserts exact `Symbol`/`FunctionEntity`/`ClassEntity`/
`ImportBinding`/`ExportBinding` shapes (every import/export kind, class inheritance resolved only
within the same file per ADR-0006, decorators/visibility/readonly on class members), a determinism
test (parsing the same content twice yields identical entity IDs), and malformed-file tolerance
(a syntax error produces a `Diagnostic`, `parseFile` never throws).

`tests/parser/end-to-end.test.ts` wires `parserProjectIndexer` into a real `AnalyzerClient` after
real Phase 1 discovery, with a real `Analyzer` (`quality/exported-function-count`) reading
`context.project.functions` — proving discovery → parsing → analysis works end-to-end, and that the
malformed fixture file doesn't abort the scan.

`tests/parser/project-indexer.test.ts` proves the file-size DoS mitigation (Section 31, added after
security review): generates a real file over `MAX_PARSEABLE_FILE_SIZE_BYTES` at test time (not a
committed fixture — a >5MB file has no place in the repo), confirms it produces no `Module` while a
normal-sized sibling file still parses correctly.

## What Phase 3 tests

`tests/graph/in-memory-graph.test.ts` tests `InMemoryGraph` in isolation from either builder: node/
edge add and lookup, an invalid edge (referencing a node that doesn't exist) throwing, `neighbors`/
`query` filtering by edge type and from/to node, and `findPaths` — shortest-path selection,
`maxDepth` enforcement, cycle safety (a graph with a cycle doesn't loop forever), and correctly
returning `[]` for disconnected or non-existent nodes.

`tests/graph/builders.test.ts` runs `buildModuleGraph`/`buildSymbolGraph` against real parsed
output (via `parseFile`, not hand-built `Module`/`Symbol` objects) from `fixtures/graph/
module-links/` and `fixtures/parser/basic-constructs/shapes.ts`, asserting exact `IMPORTS`/
`DECLARES`/`EXTENDS`/`IMPLEMENTS` edges — including that a bare specifier and an unresolvable
relative specifier both correctly produce no edge.

`tests/graph/end-to-end.test.ts` wires `graphProjectIndexer` into a real `AnalyzerClient` after real
Phase 1 discovery and Phase 2 parsing, with a real `Analyzer` (`quality/module-import-fanout`)
reading `context.graphs.moduleGraph` — proving discovery → parsing → graph-building → analysis
works end-to-end.

## Test categories to add as each phase lands (Section 30)

- **Call graph tests** (Phase 4): edge certainty correctness for dynamic dispatch, `CALLS` edges.
- **Taint tests** (Phase 5): source→sink fixtures, sanitizer recognition, false-positive fixtures.
- **Regression tests**: one per closed bug, referencing the fixture or scenario that caused it.
- **Performance benchmarks** (Section 30, Section 43 Performance Engineer): tracked separately from
  correctness tests — see `/benchmark` in `.claude/commands/benchmark.md` once implemented.
- **End-to-end tests**: extend `tests/graph/end-to-end.test.ts`'s pattern once the call graph
  (Phase 4) exists too, so the full pipeline runs against a real fixture repository with real call
  edges, not just module/symbol edges.

## Running tests

```bash
pnpm test          # vitest run, once
pnpm test:watch    # vitest watch mode
```
