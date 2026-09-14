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

**Phase 0 — Foundation & Contracts.** The domain model, core contracts, and analyzer lifecycle are
in place; no concrete analysis rules exist yet. See [`docs/project-status.md`](docs/project-status.md)
for the authoritative, up-to-date state before starting any substantial work.

## Packages

| Package | Purpose |
|---|---|
| `@code-analyzer/core` | Domain model, contracts, and the `ScanEngine` lifecycle. Zero dependencies on other workspace packages, no analysis logic. |
| `@code-analyzer/project-model` | Repository discovery -> normalized `ProjectModel` (Phase 1). |
| `@code-analyzer/parser` | AST / semantic source model (Phase 2). |
| `@code-analyzer/graph` | Module, dependency, call, and taint graphs (Phase 3-5). |
| `@code-analyzer/analyzers` | Individual analysis rules (security, architecture, quality, performance, dependency, secrets, infrastructure). |
| `@code-analyzer/engines` | Engine-level composition, finding correlation, risk scoring. |
| `@code-analyzer/integrations` | External tool normalization (SARIF, CodeQL, Semgrep, ...) and CI/CD adapters. |
| `@code-analyzer/ai` | Optional AI investigation/remediation layer. |
| `@code-analyzer/plugins` | Plugin host/loader runtime. |
| `@code-analyzer/cli` | Thin CLI adapter around `core` — no analysis logic of its own. |

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
