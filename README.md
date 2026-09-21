# codegraph-scan

**An application-aware codebase analyzer — not a linter.** Instead of matching patterns file by
file, it builds a real model of your repository first (files, symbols, import graphs, and
eventually APIs, data flow, dependencies, and infrastructure) and lets analyzers reason over that
model the way a human reviewer would: *"what does this code actually connect to?"*

It works fully offline, with no AI provider required — AI is an optional layer for investigating
and explaining findings later, never the thing doing the actual detection.

```
Repository -> ProjectModel -> AST/Symbol Model -> Graphs (module/dependency/call/taint)
  -> API/DB/Infra Models -> Application Graph -> Analyzers -> Evidence -> Finding Correlation
  -> Risk -> optional AI investigation -> ScanResult
```

## Contents

- [Features](#features)
- [Supported languages / frameworks](#supported-languages--frameworks)
- [Installation](#installation)
- [Usage](#usage)
- [HTTP API](#http-api-in-progress)
- [Sample report](#sample-report)
- [Packages](#packages)
- [Roadmap](#roadmap)
- [Developing this repo](#developing-this-repo)
- [Contributing](#contributing)

## Features

- **Real repository discovery** — walks the repo, classifies every file, detects the package
  manager, workspace layout, and frameworks (React, React Native, Angular, Vue, Node.js, Express,
  NestJS, Next.js).
- **Real parsing, not regex** — the actual TypeScript compiler for JS/TS (ESM and CommonJS) into
  functions, classes, imports, and exports; Tree-sitter for Python into the same shapes.
- **A real, queryable graph** — a Module Graph (cross-file `IMPORTS` resolution), a Symbol Graph
  (`DECLARES`/`EXTENDS`/`IMPLEMENTS`), and a Call Graph (`CALLS` edges resolved from real call
  sites, with `EdgeCertainty` — `direct`/`resolved`/`inferred`/`dynamic`/`unknown` — rather than a
  false yes/no) built over the parsed output, not just a flat file list.
- **Eight built-in analyzers** — architecture (`circular-import`, `unresolved-import`), quality
  (`unused-export`, `cyclomatic-complexity`, `duplication`, `maintainability-index`,
  `lint-style-rules`), and secrets (`pattern-scan`, real regex-based detection for AWS/GitHub/
  Google/Slack/Stripe keys and private-key blocks) — each backed by real `Evidence` (concrete
  proof, not just a rule description).
- **Test coverage ingestion** — feed an existing LCOV / Istanbul (`coverage-final.json`) /
  coverage.py report in with `--coverage <path>` and quality analyzers can see it; a file the
  report never mentions is reported as `unknown` coverage, never conflated with 0%. `code-analyzer`
  never runs your test suite itself — it only reads a report your own pipeline already produced.
- **Three report formats** — JSON (the full, schema-versioned `ScanResult`), SARIF (for GitHub
  Code Scanning and other SARIF consumers), and a self-contained interactive HTML report with
  severity/category filters, search, and real source-code snippets per finding.
- **Monorepo-aware** — pnpm/npm/yarn workspaces are detected during discovery; point it at a
  single package or the whole monorepo root.
- **HTTP API (in progress)** — `@code-analyzer/api` exposes the same `AnalyzerClient`/`ScanEngine`
  pipeline the CLI uses over HTTP: upload a code archive, get back a `ScanResult`, optionally
  streamed over SSE as the scan progresses. Stateless request/response only — no web UI, auth, or
  persistence yet.

## Supported languages / frameworks

| Language | Support level |
|---|---|
| JavaScript / TypeScript (incl. CommonJS) | Fully parsed — real Symbol Graph + Module Graph |
| Python | Fully parsed, single-file only (no cross-file import linking yet) |
| JSON, YAML, SQL, Dockerfile | Recognized but not parsed (file-tagging only) |
| C#, PHP, Java, Go, Ruby, Rust, ... | Not recognized — see [ADR-0009](docs/decisions/ADR-0009-angular-vue-python-support.md) for what adding a language actually takes |

**Frameworks detected:** React, React Native, Angular, Vue, Node.js, Express, NestJS, Next.js.

## Installation

```bash
npm install -g codegraph-scan
```

Or run it without installing:

```bash
npx codegraph-scan scan <path-to-a-repo>
```

## Usage

```bash
# Basic scan, JSON to stdout
codegraph-scan scan <path-to-a-repo> --format json

# Write an HTML report to a file
codegraph-scan scan <path-to-a-repo> --format html --out report.html

# SARIF report with a specific profile
codegraph-scan scan <path-to-a-repo> --profile standard --format sarif --out report.sarif

# Include a test coverage report (LCOV/Istanbul/coverage.py, auto-detected)
codegraph-scan scan <path-to-a-repo> --coverage coverage/lcov.info

# Re-export an existing scan result to a different format
codegraph-scan export --format sarif --in report.json --out report.sarif
```

`scan` runs real discovery, parsing, and graph-building against whatever repo you point it at, runs
the eight built-in analyzers over the resulting graph, and produces a schema-versioned
`ScanResult`.

| Flag | Values | Default |
|---|---|---|
| `--format` | `json`, `sarif`, `html` | `json` |
| `--profile` | `minimal`, `standard`, `security`, `full`, `enterprise` | `minimal` |
| `--out` | path to write the report to | stdout |
| `--coverage` | path to an LCOV / Istanbul / coverage.py report (format auto-detected) | none — coverage-aware analyzers see no data |

## HTTP API (in progress)

`@code-analyzer/api` runs the same analysis pipeline behind an HTTP server, for callers that can't
shell out to the CLI. It's scoped to a stateless scan request/response only — no web UI, auth, or
scan history/persistence yet.

```bash
# Run the server (defaults to :3000, override with PORT/HOST)
pnpm run serve:api

# Upload a .zip archive (or individual source files as multipart parts) and get a ScanResult back
curl -F "file=@repo.zip" http://localhost:3000/v1/scans

# Same, but stream ScanEvents over SSE as the scan progresses (ADR-0012)
curl -N -F "file=@repo.zip" "http://localhost:3000/v1/scans?stream=true"

# Health check
curl http://localhost:3000/v1/health
```

## Sample report

The HTML report groups findings into collapsible, per-category sections with a sidebar you can
jump between, live severity/rule filters, full-text search, and a real source-code snippet
(with the offending line highlighted) pulled straight from your repository for each finding:

```bash
codegraph-scan scan . --format html --out report.html && open report.html
```

## Packages

`packages/core` is the only package every other package depends on; it never depends back on
them — that's what keeps the CLI, a future IDE extension, and a future dashboard all sharing one
real analysis engine instead of drifting apart. See
[ADR-0001](docs/decisions/ADR-0001-monorepo-package-architecture.md) for the reasoning.

| Package | Purpose | Status |
|---|---|---|
| `@code-analyzer/core` | Domain model, contracts, and the `ScanEngine` lifecycle. Zero dependencies on other workspace packages, no analysis logic. | Implemented |
| `@code-analyzer/project-model` | Repository discovery -> normalized `ProjectModel`. | Implemented |
| `@code-analyzer/parser` | AST / semantic source model — TypeScript Compiler API for JS/TS incl. CommonJS (ADR-0006), Tree-sitter for Python (ADR-0009). | Implemented |
| `@code-analyzer/graph` | Module Graph, Symbol Graph, and Call Graph (`CALLS` edges from real call-site resolution), wired into a real `graphProjectIndexer`. | Implemented — taint graph (Phase 5) is next |
| `@code-analyzer/analyzers` | Analysis rules: circular-import, unresolved-import, unused-export, cyclomatic-complexity, duplication, maintainability-index, lint-style-rules, secrets pattern-scan. | 8 rules shipped — SAST/injection/authn/authz rules blocked on the taint graph (Phase 5); see [ADR-0010](docs/decisions/ADR-0010-security-quality-coverage-subsystems.md) |
| `@code-analyzer/cli` | `scan`/`export` commands, the eight built-in analyzers wired against an in-memory registry, an opt-in `--coverage` report flag, plus JSON/SARIF/HTML report exporters. | Implemented |
| `@code-analyzer/api` | HTTP API exposing the same `AnalyzerClient`/`ScanEngine` pipeline over HTTP — upload a code archive, get back a `ScanResult`, optional SSE streaming (ADR-0012). | In progress — stateless scan endpoint only, no web UI/auth/persistence |
| `@code-analyzer/engines` | Engine-level composition, finding correlation, risk scoring. | Not started |
| `@code-analyzer/integrations` | External tool normalization (SARIF, CodeQL, Semgrep, ...) and CI/CD adapters. LCOV/Istanbul/coverage.py test-coverage report parsing (`src/coverage/`) is its first real content. | Coverage ingestion implemented — CI/CD and other external-tool adapters not started |
| `@code-analyzer/ai` | Optional AI investigation/remediation layer. | Not started |
| `@code-analyzer/plugins` | Plugin host/loader runtime. | Not started |

## Roadmap

Not built yet: the taint graph and the SAST rules that need it (SQLi, XSS, SSRF, IDOR, authn/authz),
coupling/dead-code quality rules that need call-graph reachability, coverage×taint correlation, and
Python cross-file import resolution (Python parses per-file but doesn't yet link `import`s across
files). The Call Graph (Phase 4) is implemented — see Features above. Every phase is signed off by
a human before the next one starts — see [`docs/project-status.md`](docs/project-status.md) for the
exact, up-to-date state, and
[ADR-0010](docs/decisions/ADR-0010-security-quality-coverage-subsystems.md) /
[the tracker](docs/tasks/security-quality-coverage-modules.md) for what's planned for security,
quality, and coverage specifically.

## Developing this repo

This is a `pnpm` workspace monorepo — packages reference each other via the `workspace:*`
protocol, which `npm` and `yarn` don't resolve the same way, so `pnpm` is required here (not
optional). If you don't have it installed, use Node's built-in `corepack` rather than installing
it separately:

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate
```

Then:

```bash
git clone <this-repo>
cd codegraph-scan
pnpm install
pnpm build        # tsc -b across all packages
pnpm typecheck
pnpm test          # vitest run
pnpm lint
```

Run the CLI from source without installing the published package:

```bash
node packages/cli/dist/bin.js scan <path-to-a-repo> --format json
```

## Contributing

Read `CLAUDE.md` first. Changes to any contract in `packages/core` require an ADR
(`docs/decisions/ADR-NNNN-*.md`) and a check of every consumer package before landing. Changes
touching authentication, authorization, taint, secrets, sandboxing, or external tool execution
follow the enhanced review path in [`docs/security/overview.md`](docs/security/overview.md).
