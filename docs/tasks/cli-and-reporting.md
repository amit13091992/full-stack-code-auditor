# Task: CLI & Reporting (IMPLEMENTED — pending human review)

> Not phase-numbered like `phase-N-*.md` — this doesn't sit in the Repository → AST → Graph →
> Analyzer pipeline sequence, so it wasn't gated behind Phase 2/3. It only depended on Phase 1
> (`ProjectModel.files`) and Phase 0 (`AnalyzerClient`, `ScanResult`, `ResultExporter`), both
> already in place. ADR-0007 was approved by amit13091992@gmail.com and implementation is complete.

## Objective

Make `@code-analyzer/core`'s `ScanResult` (`packages/core/src/serialization/scan-result.ts`)
actually reach a user as a report, and give the project a real `npx code-analyzer scan .` entry
point (Section 32). Today `AnalyzerClient.scan()` only returns a plain object to whatever Node
process imported it — there is no exporter implementation and no CLI at all.

## Scope

- **`ResultExporter` implementations** for `json`, `sarif`, and `html` (the three formats already
  named in the `ResultExporter` contract). Package home: `@code-analyzer/cli`, per that package's
  own stated purpose ("output formatting, and wiring to AnalyzerClient" —
  `packages/cli/package.json`'s description). This needs an ADR (`ADR-0007`) confirming that
  placement rather than, say, `@code-analyzer/integrations` — see Alternatives below.
  - `json`: `JSON.stringify(scanResult, null, 2)` — the `ScanResult` shape is already the contract,
    no transformation needed beyond pretty-printing.
  - `sarif`: a minimal SARIF 2.1.0 `sarifLog` — one `run`, `tool.driver.name = "code-analyzer"`,
    one SARIF `result` per `Finding` (`ruleId` ← `Finding.ruleId`, `level` ← mapped from
    `Finding.severity`, `message.text` ← `Finding.description`, `locations` ← mapped from
    `Finding.locations`). This is what makes GitHub Code Scanning / most CI security dashboards
    able to ingest our output (Section 33).
  - `html`: a single self-contained static HTML file — findings grouped by severity, using
    `ScanSummary` for the top-of-page counts. No client-side JS/interactivity required for v1;
    this is a report artifact, not a dashboard (Section 32 vs. a future Section 34 web UI).
- **CLI commands** (`@code-analyzer/cli`, currently an empty stub):
  - `code-analyzer scan <root> [--profile <profile>] [--format json|sarif|html] [--out <path>]` —
    builds an `AnalyzerConfig` from flags + defaults, wires `projectModelDiscoverer` (Phase 1, real)
    as the `discoverer` and a passthrough `{ index: async (project) => ({ project, graphs: {} }) }`
    as the `indexer` (no real `ProjectIndexer` exists until Phase 2), runs `AnalyzerClient.scan()`
    against whatever analyzers are registered (zero today — `@code-analyzer/analyzers` is still an
    empty stub), and writes the report via the exporter matching `--format` (default `json`, default
    destination stdout, `--out` writes to a file). Prints a short human-readable summary line
    (`ScanSummary`) to stderr regardless of `--format`, so `--format json > result.json` still gives
    visible progress.
  - `code-analyzer export --format <fmt> --in <scan-result.json> --out <path>` — re-exports an
    already-produced `ScanResult` (e.g. from a previous JSON run) into `sarif`/`html`, so CI doesn't
    have to re-scan just to change report format.
- **`bin` entry point**: `packages/cli/package.json` gets a `"bin": { "code-analyzer": "./dist/bin.js" }`
  so `npx code-analyzer scan .` (Section 32) works once published; `bin.js` is a thin shebang wrapper
  around the argument parser.
- **Hand-rolled argument parsing**, not a CLI framework dependency (`commander`/`yargs`/etc.) — two
  commands with ~5 flags each doesn't justify a new dependency per `CLAUDE.md`'s dependency policy
  ("new third-party dependencies need a stated reason"). Revisit once `explain`/`graph`/`endpoints`/
  `dependencies` (Section 32's fuller command list) actually exist and the flag grammar gets more
  complex — that's a real reason, this isn't yet.

## Non-goals

- Any actual `Finding`-producing analyzer — `scan` will legitimately produce zero findings today,
  because `@code-analyzer/analyzers` has none registered yet. This task proves the report pipeline
  works, not that the analyzer catches anything (that's Section 7/17/18, much later).
- `explain`, `graph`, `endpoints`, `dependencies` CLI subcommands (Section 32's fuller list) — each
  needs data this project doesn't have yet (finding detail lookup, the application graph, the
  endpoint model, the dependency graph). Don't stub them out as no-ops; just don't add them yet.
- `--changed` / incremental scan CLI flag — depends on the Section 29 cache, not built.
- `--fail-on <severity>` CI-gating exit codes — cheap to add, but deferred so this task stays scoped
  to "does a report reach the user," not CI policy design; can be a fast follow-up task.
- CI/CD platform adapters (GitHub Actions, GitLab CI, etc. — Section 33) and IDE extensions
  (Section 34) — separate tasks, consume the same `ScanResult`/exporters once those exist but aren't
  in scope here.
- SARIF/other-tool *ingestion* (reading a CodeQL/Semgrep SARIF file into our `Finding` model) — that
  is `@code-analyzer/integrations`' job (Section 23), the opposite direction from this task's SARIF
  *export*. Don't conflate the two just because they're both "SARIF."

## Dependencies

Phase 1 (`docs/tasks/phase-1-repository-discovery.md`) for real discovery to run `scan` against.
Does not depend on Phase 2/3 — `--format` output will just reflect however few `findings` exist at
the time (zero today, more as later phases land), which is correct, not broken.

## Files / packages affected

`packages/cli/src/**` (currently `export {};`). `packages/cli/package.json` gains a `bin` field and
whatever minimal runtime deps the exporters need (none anticipated — hand-written string building
is sufficient for JSON/SARIF/HTML at this size).

## Interface changes

None to `ScanResult`/`ResultExporter`/`AnalyzerConfig`/`ScanOptions` — this task is entirely an
implementation behind existing Phase 0 contracts. If SARIF export reveals a `Finding` field that's
genuinely missing (e.g. a stable rule-help-URI field), that's a core-contract change requiring its
own ADR + architect review, not something to patch around inside the exporter.

## Implementation requirements

- Exporters are pure functions (`ScanResult -> string`) — no filesystem/network access inside
  `packages/core`'s `ResultExporter` implementations; the CLI command layer (which does own file
  I/O) is the only place that touches `fs`.
- CLI never executes anything from the scanned repository (Section 31) — `scan <root>` only ever
  reaches into `root` through `projectModelDiscoverer`'s read-only filesystem walk.
- Exit code `0` on a completed scan regardless of finding count (no `--fail-on` yet, see
  Non-goals) — a non-zero exit is reserved for the CLI actually failing to run (bad flags, discovery
  error, uncaught exception), not for "findings exist."
- SARIF output must be correctly shaped for the subset of fields it emits — even a minimal
  `sarifLog` needs to be right or GitHub Code Scanning will silently reject it. As implemented, this
  requirement is satisfied via targeted structural assertions against those fields, not a full
  SARIF 2.1.0 JSON Schema validation pass — that stronger guarantee was deliberately deferred (see
  ADR-0007 and its Consequences section); this line was updated post-implementation so this
  requirement reads consistently with what ADR-0007 actually decided, rather than overstating it.

## Tests

- Unit tests per exporter (`tests/cli/exporters.test.ts`): a fixed `ScanResult` fixture (2 findings,
  critical + info severity) → exact JSON round-trip, structural SARIF assertions (version, schema,
  rule dedup, level mapping, 0-based→1-based line/column conversion), and HTML content assertions —
  including an HTML-injection test proving untrusted `Finding` content (title/description) can't
  break out of text content into executable markup.
- CLI integration tests (`tests/cli/scan-command.test.ts`, `tests/cli/export-command.test.ts`,
  `tests/cli/args.test.ts`): run `scan`/`export` against real `fixtures/project-model/` fixtures
  end-to-end (no new fixture repos needed), covering success paths (all 3 formats, `--out` file
  writing, `export` re-formatting a prior JSON result) and failure paths (missing root, unknown
  `--format`, missing required flags, unreadable `--in` file) with non-zero exit codes and readable
  error messages.
- SARIF correctness: verified via structural assertions against the SARIF 2.1.0 fields actually
  emitted, per ADR-0007 — not a full schema-validation library (deferred, see ADR-0007
  Consequences).

## Acceptance criteria

- [x] ADR-0007 written and accepted: exporters live in `@code-analyzer/cli`, not
      `@code-analyzer/integrations` (which stays reserved for ingesting external tool output); no
      CLI framework dependency added for the initial 2 commands.
- [x] `json`, `sarif`, `html` exporters implemented (`packages/cli/src/exporters/`), each with
      passing tests against a fixed `ScanResult` fixture.
- [x] `code-analyzer scan <root>` works end-to-end against a real fixture repo, using real Phase 1
      discovery, producing a report in all three formats — verified both via `vitest` and by
      running the built `dist/bin.js` directly against `fixtures/project-model/`.
- [x] `code-analyzer export` re-exports a previously produced JSON `ScanResult` into `sarif`/`html`.
- [x] `pnpm build`, `pnpm typecheck`, `pnpm test` (29/29), `pnpm lint` all pass clean across the
      whole workspace.
- [x] `docs/project-status.md` updated to move this task from "next approved" to "completed".
- [ ] Human review before this is wired into any CI/CD adapter (Section 33) or published to npm.
