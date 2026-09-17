# codegraph-scan

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

**Phase 3 — Graph Foundation**, complete and reviewed, plus a working CLI with its first three
real analyzers wired in. Concretely, today `codegraph-scan scan <repo>` will:

1. Walk the repository, classify every file, and detect the package manager, workspace layout,
   and frameworks (React, React Native, Angular, Vue, Node.js, Express, NestJS, Next.js).
2. Parse every JS/TS file with the real TypeScript compiler (ESM and CommonJS) into functions,
   classes, imports, and exports; parse Python with Tree-sitter into the same shapes.
3. Build a Module Graph (cross-file `IMPORTS` resolution) and a Symbol Graph
   (`DECLARES`/`EXTENDS`/`IMPLEMENTS`) over the parsed output.
4. Run three built-in analyzers over that graph — **circular-import**, **unresolved-import**, and
   **unused-export** — and emit real `Finding`s.
5. Report the result as JSON, SARIF, or HTML.

What it *can't* do yet: call graphs, data-flow/taint graphs, security/architecture rules beyond
the three above, and Python cross-file import resolution (Python parses per-file but doesn't yet
link `import`s across files — see `docs/project-status.md`'s technical debt).

Every phase gets signed off by a human before the next one starts — see
[`docs/project-status.md`](docs/project-status.md) for the exact, up-to-date state, what's been
reviewed, and what's next.

## Packages

| Package | Purpose |
|---|---|
| `@code-analyzer/core` | Domain model, contracts, and the `ScanEngine` lifecycle. Zero dependencies on other workspace packages, no analysis logic. |
| `@code-analyzer/project-model` | Repository discovery -> normalized `ProjectModel` (Phase 1, implemented). |
| `@code-analyzer/parser` | AST / semantic source model — TypeScript Compiler API for JS/TS incl. CommonJS (ADR-0006), Tree-sitter for Python (ADR-0009). Implemented. |
| `@code-analyzer/graph` | Module Graph + Symbol Graph, wired into a real `graphProjectIndexer` (Phase 3, implemented); call graph and taint graph land in Phase 4/5. |
| `@code-analyzer/analyzers` | Analysis rules. Ships three today: circular-import, unresolved-import, unused-export. Security/architecture/quality/performance/dependency/secrets/infrastructure rules not started yet. |
| `@code-analyzer/engines` | Engine-level composition, finding correlation, risk scoring — not started yet. |
| `@code-analyzer/integrations` | External tool normalization (SARIF, CodeQL, Semgrep, ...) and CI/CD adapters — not started yet. |
| `@code-analyzer/ai` | Optional AI investigation/remediation layer — not started yet. |
| `@code-analyzer/plugins` | Plugin host/loader runtime — not started yet. |
| `@code-analyzer/cli` | `scan`/`export` commands, the three built-in analyzers wired against an in-memory registry, plus JSON/SARIF/HTML report exporters. Implemented. |

`packages/core` is the only package every other package depends on; it never depends back on them
— that's what keeps the CLI, a future IDE extension, and a future dashboard all sharing one real
analysis engine instead of drifting apart. See [ADR-0001](docs/decisions/ADR-0001-monorepo-package-architecture.md)
for the reasoning.

## Supported languages / frameworks

**Fully parsed** (real Symbol Graph + Module Graph support): JavaScript, TypeScript (incl.
CommonJS). **Fully parsed, single-file only** (no cross-file import linking yet): Python.
**Recognized but not parsed** (file-tagging only): JSON, YAML, SQL, Dockerfile. **Not recognized at
all**: everything else (C#, PHP, Java, Go, Ruby, Rust, ...) — see
[ADR-0009](docs/decisions/ADR-0009-angular-vue-python-support.md) for what adding a language
actually takes.

Frameworks detected: React, React Native, Angular, Vue, Node.js, Express, NestJS, Next.js.

Works against a single repository or a monorepo (pnpm/npm/yarn workspaces are detected during
discovery).

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
codegraph-scan scan <path-to-a-repo> --format json            # or sarif / html
codegraph-scan scan <path-to-a-repo> --format html --out report.html
codegraph-scan scan <path-to-a-repo> --profile standard --format sarif --out report.sarif
codegraph-scan export --format sarif --in report.json --out report.sarif
```

`scan` runs real discovery, parsing, and graph-building against whatever repo you point it at, runs
the three built-in analyzers over the resulting graph, and produces a schema-versioned
`ScanResult`. `--profile` accepts `minimal` (default), `standard`, `security`, `full`, or
`enterprise`; `--format` accepts `json` (default), `sarif`, or `html`.

## Developing this repo

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
