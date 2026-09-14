# Task: Phase 1 — Repository Discovery (DRAFT — not approved to start)

> Per `docs/project-status.md`: Phase 0 must be signed off by a human before this task begins.
> This draft exists so Phase 1 scope is visible during Phase 0 review, not as a green light.

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

Fixture repositories under `fixtures/` (to be added) covering: a plain Node/Express repo, a
NestJS repo, a Next.js repo, a React Native repo, a monorepo with multiple package managers, and a
repo with generated code (e.g. a `dist/` or `*.generated.ts` pattern) to verify classification.

## Acceptance criteria

- [ ] `RepositoryDiscoverer` implemented and exported from `@code-analyzer/project-model`.
- [ ] Fixture tests pass for every framework/package-manager combination listed above.
- [ ] `docs/project-status.md` updated to move this task from "next approved" to "completed".
