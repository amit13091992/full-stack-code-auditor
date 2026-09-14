# code-analyzer

**An application-aware codebase analyzer — not a linter.** Instead of matching patterns file by
file, it builds a real model of your repository first (files, symbols, import graphs, and
eventually APIs, data flow, dependencies, and infrastructure) and lets analyzers reason over that
model the way a human reviewer would: "what does this code actually connect to?"

```
Repository -> ProjectModel -> AST/Symbol Model -> Graphs (module/dependency/call/taint)
  -> API/DB/Infra Models -> Application Graph -> Analyzers -> Evidence -> Finding Correlation
  -> Risk -> optional AI investigation -> ScanResult
```

It works fully offline, with no AI provider required — AI is an optional layer for investigating
and explaining findings later, never the thing doing the actual detection.

## Where things stand

**Phase 3 — Graph Foundation**, plus a working CLI. In plain terms: the engine can already walk a
real repository, parse every JS/TS file, and build a graph of which files import which — the
groundwork every future analysis rule will sit on top of. What it *can't* do yet is flag real
issues (security bugs, architecture violations, etc.) — that's still ahead, once the graph work
(call graphs, data flow) and the actual rule engines are built.

Concretely, today:

- **Discovery** (Phase 1) — walks a repo, classifies every file, detects the package manager,
  workspace layout, and frameworks (React, Express, NestJS, Next.js, ...).
- **Parsing** (Phase 2) — parses every JS/TS file into functions, classes, imports, and exports
  using the real TypeScript compiler, not regex. Understands both ES modules and CommonJS
  (`require()`/`module.exports`), so genuinely legacy Node.js code works too.
- **Python** — a second language, parsed with Tree-sitter (functions, classes, imports). Same
  Symbol Graph support as JS/TS; cross-file import linking for Python isn't built yet (see
  `docs/project-status.md`).
- **Graphs** (Phase 3, this round) — links files together by their imports, and links classes to
  what they extend/implement, into a real queryable graph.
- **Reporting** — `code-analyzer scan <repo>` runs real discovery and produces a JSON, SARIF, or
  HTML report — though the findings list is empty for now, since no rule engine exists yet
  (see [ADR-0007](docs/decisions/ADR-0007-cli-reporting-exporters.md)). Parsing and graph-building
  aren't wired into the CLI yet (see `docs/project-status.md`'s technical debt); think of `scan`
  today as proof the discovery → report pipeline works end-to-end, with parsing, graphs, and actual
  detections still to come.

Every phase gets signed off by a human before the next one starts — see
[`docs/project-status.md`](docs/project-status.md) for the exact, up-to-date state, what's been
reviewed, and what's next.

## Packages

| Package | Purpose |
|---|---|
| `@code-analyzer/core` | Domain model, contracts, and the `ScanEngine` lifecycle. Zero dependencies on other workspace packages, no analysis logic. |
| `@code-analyzer/project-model` | Repository discovery -> normalized `ProjectModel` (Phase 1, implemented). |
| `@code-analyzer/parser` | AST / semantic source model — TypeScript Compiler API for JS/TS incl. CommonJS (ADR-0006), Tree-sitter for Python (ADR-0009). Implemented. |
| `@code-analyzer/graph` | Module Graph + Symbol Graph (Phase 3, implemented); call graph and taint graph land in Phase 4/5. |
| `@code-analyzer/analyzers` | Individual analysis rules (security, architecture, quality, performance, dependency, secrets, infrastructure) — not started yet. |
| `@code-analyzer/engines` | Engine-level composition, finding correlation, risk scoring — not started yet. |
| `@code-analyzer/integrations` | External tool normalization (SARIF, CodeQL, Semgrep, ...) and CI/CD adapters — not started yet. |
| `@code-analyzer/ai` | Optional AI investigation/remediation layer — not started yet. |
| `@code-analyzer/plugins` | Plugin host/loader runtime — not started yet. |
| `@code-analyzer/cli` | `scan`/`export` commands plus JSON/SARIF/HTML report exporters — no analysis logic of its own. Implemented. |

`packages/core` is the only package every other package depends on; it never depends back on them
— that's what keeps the CLI, a future IDE extension, and a future dashboard all sharing one real
analysis engine instead of drifting apart. See [ADR-0001](docs/decisions/ADR-0001-monorepo-package-architecture.md)
for the reasoning.

## Supported languages / frameworks

**Fully parsed** (real Symbol Graph support): JavaScript, TypeScript (incl. CommonJS). **Fully
parsed, single-file only** (no cross-file import linking yet): Python. **Recognized but not
parsed** (file-tagging only): JSON, YAML, SQL, Dockerfile. **Not recognized at all**: everything
else (C#, PHP, Java, Go, Ruby, Rust, ...) — see [ADR-0009](docs/decisions/ADR-0009-angular-vue-python-support.md)
for what adding a language actually takes.

Frameworks detected: React, React Native, Angular, Vue, Node.js, Express, NestJS, Next.js.

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

`scan` runs real discovery against whatever repo you point it at and produces a schema-versioned
`ScanResult`. It doesn't yet run the real Phase 2 parser or Phase 3 graph-builders — its indexer is
still a passthrough stub (see `docs/project-status.md`'s technical debt) — and its `findings` list is
empty until a real `Analyzer` is registered in `@code-analyzer/analyzers`. This is deliberate: it
proves the discover → report pipeline works end-to-end before parsing, graphs, and detection logic
are wired in on top of it.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — durable project conventions for contributors and coding agents
- [`docs/architecture/overview.md`](docs/architecture/overview.md) — full pipeline and package boundaries
- [`docs/domain-model/overview.md`](docs/domain-model/overview.md) — domain entities
- [`docs/analyzer-engine/lifecycle.md`](docs/analyzer-engine/lifecycle.md) — the scan lifecycle
- [`docs/graph/overview.md`](docs/graph/overview.md) · [`docs/parser/overview.md`](docs/parser/overview.md) · [`docs/security/overview.md`](docs/security/overview.md)
- [`docs/testing/strategy.md`](docs/testing/strategy.md) — fixtures and test layout
- [`docs/decisions/`](docs/decisions/) — architecture decision records (the "why" behind each phase's choices)
- [`docs/project-status.md`](docs/project-status.md) — current phase, what's reviewed, what's next

## Contributing

Read `CLAUDE.md` first. Changes to any contract in `packages/core` require an ADR
(`docs/decisions/ADR-NNNN-*.md`) and a check of every consumer package before landing. Changes
touching authentication, authorization, taint, secrets, sandboxing, or external tool execution
follow the enhanced review path in [`docs/security/overview.md`](docs/security/overview.md).
