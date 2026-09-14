# code-analyzer

Application-aware full-stack codebase analyzer. Not a linter — an engine that builds a normalized
model of a repository (code, symbols, graphs, APIs, data flow, dependencies, architecture,
infrastructure) and lets deterministic analyzers and an optional AI layer reason over that model.

```
Repository -> ProjectModel -> AST/Symbol Model -> Graphs (module/dependency/call/taint)
  -> API/DB/Infra Models -> Application Graph -> Analyzers -> Evidence -> Finding Correlation
  -> Risk -> optional AI investigation -> ScanResult
```

The core analyzer works fully without any AI provider — AI is an optional layer on top, never the
primary detection mechanism.

## Status

**Phase 2 — AST & Semantic Source Model**, plus a working CLI. Phase 0 (domain model, core
contracts, analyzer lifecycle) and Phase 1 (`RepositoryDiscoverer` — filesystem discovery, file
classification, package-manager/workspace detection, framework detection) are signed off. Phase 2's
`@code-analyzer/parser` — TypeScript Compiler API parsing into `Module`/`Symbol`/`FunctionEntity`/
`ClassEntity` (ADR-0006) — is implemented and tested end-to-end through the real `AnalyzerClient`
lifecycle, running on real Phase 1 discovery output. `code-analyzer scan <root>` runs a real scan
and produces a JSON/SARIF/HTML report today, though `findings` is legitimately empty until a real
analyzer exists (that's Phase 5+ — see [ADR-0007](docs/decisions/ADR-0007-cli-reporting-exporters.md)).
See [`docs/project-status.md`](docs/project-status.md) for the authoritative, up-to-date state
before starting any substantial work.

## Packages

| Package | Purpose |
|---|---|
| `@code-analyzer/core` | Domain model, contracts, and the `ScanEngine` lifecycle. Zero dependencies on other workspace packages, no analysis logic. |
| `@code-analyzer/project-model` | Repository discovery -> normalized `ProjectModel` (Phase 1, implemented). |
| `@code-analyzer/parser` | AST / semantic source model — TypeScript Compiler API parsing (Phase 2, implemented, ADR-0006). |
| `@code-analyzer/graph` | Module, dependency, call, and taint graphs (Phase 3-5). |
| `@code-analyzer/analyzers` | Individual analysis rules (security, architecture, quality, performance, dependency, secrets, infrastructure). |
| `@code-analyzer/engines` | Engine-level composition, finding correlation, risk scoring. |
| `@code-analyzer/integrations` | External tool normalization (SARIF, CodeQL, Semgrep, ...) and CI/CD adapters. |
| `@code-analyzer/ai` | Optional AI investigation/remediation layer. |
| `@code-analyzer/plugins` | Plugin host/loader runtime. |
| `@code-analyzer/cli` | Thin CLI adapter around `core` (`scan`, `export` commands) plus the JSON/SARIF/HTML `ResultExporter` implementations — no analysis logic of its own. Implemented. |

`packages/core` is the only package every other package depends on; it never depends back on them.
See [ADR-0001](docs/decisions/ADR-0001-monorepo-package-architecture.md) for why.

## Supported languages / frameworks (initial)

JavaScript, TypeScript, JSON, YAML, SQL, Dockerfile. Frameworks: React, React Native, Node.js,
Express, NestJS, Next.js.

## Getting started

```bash
pnpm install
pnpm build        # tsc -b across all packages
pnpm typecheck
pnpm test          # vitest run
pnpm lint
```

## Running a scan

```bash
node packages/cli/dist/bin.js scan <path-to-a-repo> --format json   # or sarif / html
node packages/cli/dist/bin.js scan <path-to-a-repo> --format html --out report.html
node packages/cli/dist/bin.js export --format sarif --in report.json --out report.sarif
```

`scan` runs real Phase 1 repository discovery and produces a schema-versioned `ScanResult`, but
`findings` will be empty until a real `Analyzer` is registered in `@code-analyzer/analyzers`
(Phase 5+) — this proves the discovery → report pipeline works end-to-end, not that anything is
detected yet.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — durable project conventions for contributors and coding agents
- [`docs/architecture/overview.md`](docs/architecture/overview.md) — full pipeline and package boundaries
- [`docs/domain-model/overview.md`](docs/domain-model/overview.md) — domain entities
- [`docs/analyzer-engine/lifecycle.md`](docs/analyzer-engine/lifecycle.md) — the scan lifecycle
- [`docs/graph/overview.md`](docs/graph/overview.md) · [`docs/parser/overview.md`](docs/parser/overview.md) · [`docs/security/overview.md`](docs/security/overview.md)
- [`docs/testing/strategy.md`](docs/testing/strategy.md) — fixtures and test layout
- [`docs/decisions/`](docs/decisions/) — architecture decision records
- [`docs/project-status.md`](docs/project-status.md) — current phase and what's approved next

## Contributing

Read `CLAUDE.md` first. Changes to any contract in `packages/core` require an ADR
(`docs/decisions/ADR-NNNN-*.md`) and a check of every consumer package before landing. Changes
touching authentication, authorization, taint, secrets, sandboxing, or external tool execution
follow the enhanced review path in [`docs/security/overview.md`](docs/security/overview.md).
