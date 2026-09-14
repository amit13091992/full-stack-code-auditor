# ADR-0001: Monorepo Package Architecture

## Status

Accepted

## Context

The analyzer must be reusable as a library first, with the CLI, CI/CD integration, IDE
extensions, dashboards, and AI features all consuming the same core analysis logic (Section 1/3).
We need package boundaries that:

- prevent the CLI from accumulating its own analysis logic,
- let the security/architecture/performance engines evolve independently,
- keep the AI layer strictly optional (Section 57/59),
- avoid premature fragmentation (Section 35.5, 35.12).

## Decision

Use a pnpm workspace monorepo with 10 packages:

```
packages/
  core           domain model, contracts, ScanEngine lifecycle — zero analysis logic
  project-model  Phase 1 repository discovery -> ProjectModel
  parser         Phase 2 AST/semantic model
  graph          Phase 3-5 graph implementation, call graph, taint graph
  analyzers      individual Analyzer (rule) implementations
  engines        engine-level composition (SecurityEngine, ArchitectureEngine, ...), correlation, risk
  integrations   external tool normalization (SARIF, CodeQL, Semgrep, OSV, ...) + CI/CD adapters
  ai             product AI layer (ReasoningProvider abstraction) — optional at runtime
  plugins        plugin host/loader runtime
  cli            thin adapter around core; no analysis logic
```

`core` has no dependency on any other package. Every other package depends on `core`. `cli`,
`integrations`, and `ai` are the only packages allowed to be "leaf" consumers with no other
package depending on them.

## Alternatives considered

- **Single package, folders instead of packages.** Rejected: makes "CLI must not contain analysis
  logic" unenforceable — nothing stops an import cycle. A package boundary is a real dependency-
  direction enforcement mechanism (`workspace:*` + a lint rule against reaching into another
  package's `src/`), a folder boundary is not.
- **Fewer, larger packages** (e.g. merge `analyzers` + `engines`, or `parser` + `graph`). Considered,
  but the ownership split in Section 42 (Parser Engineer vs. Graph Engineer vs. Security Engineer)
  maps directly onto these boundaries, and each has a distinct release cadence (parser changes are
  rare and risky; analyzer rules change constantly).
- **More, smaller packages** (e.g. one package per analyzer category). Rejected per Section 35.5 —
  no genuine ownership/dependency reason yet; revisit only if `analyzers` becomes unwieldy.

## Consequences

- Every new analyzer is added to `packages/analyzers` (or a category subfolder within it) and
  registered against the `AnalyzerRegistry` contract from `core` — never reaches into `graph` or
  `parser` internals directly, only through `core`'s exported contracts.
- `core` changes are the highest-blast-radius changes in the repo and require the review path in
  Section 47/48.
- Stub packages created in Phase 0 (empty `src/index.ts`) exist purely to fix the boundary and the
  dependency direction before any implementation exists, per Section 37.
