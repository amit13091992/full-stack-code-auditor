# Task: Phase 1 — Repository Discovery (IMPLEMENTED — pending human review)

> Phase 0 was signed off by amit13091992@gmail.com. Implementation is complete and tested; see
> ADR-0005 for the implementation decisions and `docs/project-status.md` for current status.

## Objective

Implement `RepositoryDiscoverer` (`packages/core/src/analyzer/pipeline.ts`) in
`@code-analyzer/project-model`: filesystem discovery, ignore handling, source classification,
generated-code detection, language/framework/package-manager detection, producing a `ProjectModel`
with `repository`, `files`, and `frameworks` populated (all other collections remain empty until
Phase 2+).

## Scope

- Walk the repository root respecting `.gitignore` + `AnalyzerConfig.ignore.patterns`.
- Classify each file: `SourceClassification` (source/test/config/infrastructure/generated/
  vendored/documentation/asset/unknown) and `LanguageId` (javascript/typescript/json/yaml/sql/
  dockerfile/unknown per Section 5).
- Detect package manager(s) and workspace packages (`WorkspacePackage[]` on `Repository`).
- Detect frameworks from Section 5's first-class list: react, react-native, node, express, nestjs,
  nextjs — populate `ProjectModel.frameworks`.
- Compute `SourceFile.contentHash` for later incremental-analysis use (Section 29), even though the
  cache itself is not built in this task.

## Non-goals

- AST parsing (Phase 2).
- Symbol/module resolution (Phase 2).
- Any graph construction (Phase 3+).
- Additional languages/frameworks beyond Section 5's initial list.

## Dependencies

Phase 0 (this repo's current state) — `ProjectModel`, `SourceFile`, `Repository`,
`RepositoryDiscoverer` contracts.

## Files / packages affected

`packages/project-model/src/**` (currently empty stub).

## Interface changes

None expected — `RepositoryDiscoverer.discover()` already has the right signature. If discovery
needs config `project-model` doesn't yet have a place for, extend `AnalyzerConfig` via ADR, don't
bypass it with ad hoc options.

## Implementation requirements

- No network access.
- No execution of repository content (Section 31 — discovery only reads bytes and file metadata).
- Deterministic output for the same repository state (required for incremental caching and for
  fixture-based tests to be stable).

## Tests

Fixture repositories under `fixtures/project-model/`: `node-express` (npm), `nestjs-app` (pnpm),
`nextjs-app` (yarn), `react-native-app` (bun), `monorepo-pnpm` (2 workspace packages, express +
react), `generated-code` (dist/, `*.generated.ts`, Dockerfile, GitHub Actions workflow, SQL
migration, README — exercises every `SourceClassification`). 12 tests total in
`tests/project-model/`: 7 classification/detection tests + 1 determinism test
(`discover.test.ts`), and 2 true end-to-end tests running real discovery through the actual
`AnalyzerClient.scan()` lifecycle with a real `Analyzer` (`end-to-end.test.ts`).

## Acceptance criteria

- [x] `RepositoryDiscoverer` implemented and exported from `@code-analyzer/project-model`
      (`projectModelDiscoverer`).
- [x] Fixture tests pass for every framework/package-manager combination listed above.
- [x] End-to-end: real discovery wired into `AnalyzerClient`/`ScanEngine`, exercised by a real
      `Analyzer` reading `context.project.files` — not just discoverer-in-isolation tests.
- [x] `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint` all pass clean across the whole
      workspace (this task also fixed a pre-existing `tsc -b --noEmit` + composite-project-
      references bug in every package's `typecheck` script, surfaced by actually running
      `pnpm typecheck` end-to-end for the first time).
- [x] `docs/project-status.md` updated to move this task from "next approved" to "completed".
- [ ] Human review of the implementation (classification rules, workspace-glob scope, ADR-0005's
      decisions) before Phase 2 is drafted for approval.
