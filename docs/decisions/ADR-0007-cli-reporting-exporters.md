# ADR-0007: CLI Ownership of ResultExporter Implementations, No CLI Framework Yet

## Status

Accepted (amit13091992@gmail.com)

## Context

`docs/tasks/cli-and-reporting.md` needs a home for the `json`/`sarif`/`html` implementations of
`ResultExporter` (`packages/core/src/serialization/scan-result.ts`), and a decision on how the two
initial CLI commands (`scan`, `export`) parse arguments.

## Decision

- **Exporters live in `@code-analyzer/cli`** (`packages/cli/src/exporters/`), not
  `@code-analyzer/integrations`. `integrations`'s stated purpose (`docs/architecture/overview.md`,
  README package table) is normalizing *external* tool output (CodeQL, Semgrep, OSV, Trivy,
  Gitleaks SARIF) *into* our `Finding` model — the opposite direction from turning our own
  `ScanResult` *into* a SARIF file for GitHub Code Scanning to consume. Keeping both directions in
  one package under the shared label "SARIF" would conflate ingestion and export, two concerns with
  different consumers and different failure modes (a bad ingestion normalizer produces wrong
  findings; a bad exporter produces a report a downstream tool silently rejects).
  `@code-analyzer/cli`'s own package description already claims "output formatting" as its job — so
  this is the existing boundary, not a new one.
- **No CLI framework dependency** (`commander`, `yargs`, `citty`, etc.) for the initial `scan` and
  `export` commands. Each has ~4-5 flags with no subcommand nesting; a ~40-line hand-rolled parser
  in `packages/cli/src/args.ts` covers this without a new dependency, consistent with CLAUDE.md's
  dependency policy ("new third-party dependencies need a stated reason").
- **SARIF correctness is verified by targeted structural assertions** against the SARIF 2.1.0
  fields we actually emit (`version`, `$schema`, `runs[].tool.driver.name`,
  `runs[].results[].ruleId`/`level`/`message.text`/`locations[].physicalLocation`), not a full
  schema-validation library. A complete SARIF 2.1.0 JSON Schema is large and mostly describes fields
  we don't populate; hand-asserting the subset we control is proportionate for a v1 exporter with no
  external consumer yet.

## Alternatives considered

- **Exporters in `@code-analyzer/integrations`.** Rejected per the ingestion-vs-export direction
  argument above.
- **A new `@code-analyzer/reporting` package.** Considered — would cleanly separate "format a
  `ScanResult`" from "parse CLI flags and write files." Deferred: no second consumer exists yet
  (only the CLI calls these exporters today); Section 35.5 says avoid premature package
  fragmentation. Revisit with a new ADR if/when a dashboard or IDE extension needs the same exporter
  logic without pulling in CLI's argument-parsing code.
- **`commander`/`yargs` now, since the CLI will grow more commands later** (Section 32's fuller
  list: `explain`, `graph`, `endpoints`, `dependencies`). Rejected for *this* task — those commands
  need data (finding detail lookup, the graph, the endpoint model) this project doesn't have yet, so
  adding the dependency now would be speculative. Add it in whichever task actually implements the
  first of those commands, when the flag-grammar complexity is real, not anticipated.
- **Full SARIF 2.1.0 schema validation via `ajv` + the published schema.** Deferred as
  disproportionate for a v1 exporter with no real consumer yet; add it if/when this output is
  actually fed into GitHub Code Scanning or another real SARIF consumer and something rejects it.

## Consequences

- If a second consumer (dashboard, IDE extension, CI adapter) needs the same JSON/SARIF/HTML
  formatting logic without the CLI's argument-parsing/file-I/O code, extracting a
  `@code-analyzer/reporting` package is a natural, anticipated follow-up ADR — not a surprise.
- Adding `explain`/`graph`/`endpoints`/`dependencies` later is the trigger condition for revisiting
  the "no CLI framework" call, not a fixed timeline.
- The SARIF exporter's correctness guarantee is scoped to "the fields we emit are shaped correctly,"
  not "this file is schema-valid SARIF 2.1.0 in full" — acceptable for now, but should be
  strengthened (real schema validation) before this output is relied on by an external tool in a
  CI/CD adapter task (Section 33).
