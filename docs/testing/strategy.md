# Testing Strategy

Section 30/51: test fixtures are first-class from the beginning; a task is not "done" because it
compiles.

## Layout

```
tests/                    unit + integration tests, mirrors packages/*/src structure
  core/
    scan-engine.test.ts    lifecycle contract tests (Phase 0)
fixtures/                 input repositories + expected-output fixtures (Section 30)
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

`fixtures/*` is empty in Phase 0 — populated starting Phase 5 (taint engine) and Section 7
(security analyzers), once there is a real analyzer to assert findings against. Each fixture
package, when added, must define: source project, expected findings, expected paths, expected
severity, expected confidence range (Section 30) — and a matching **false-positive** fixture
(Section 30: "as important as vulnerability fixtures").

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

## Test categories to add as each phase lands (Section 30)

- **Parser tests** (Phase 2): AST normalization, syntax-error tolerance, incremental re-parse.
- **Graph tests** (Phase 3-5): edge certainty correctness, path reconstruction, cycle handling.
- **Taint tests** (Phase 5): source→sink fixtures, sanitizer recognition, false-positive fixtures.
- **Regression tests**: one per closed bug, referencing the fixture or scenario that caused it.
- **Performance benchmarks** (Section 30, Section 43 Performance Engineer): tracked separately from
  correctness tests — see `/benchmark` in `.claude/commands/benchmark.md` once implemented.
- **End-to-end tests**: full `AnalyzerClient.scan()` over a real fixture repository once
  `project-model`/`parser`/`graph` have real implementations, not fixture strategies.

## Running tests

```bash
pnpm test          # vitest run, once
pnpm test:watch    # vitest watch mode
```
