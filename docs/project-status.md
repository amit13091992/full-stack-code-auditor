# Project Status

Machine- and human-readable status tracker (Section 49). Agents must read this before starting
substantial work and must not decide unilaterally that the project has advanced to the next phase —
that decision is made by a human and recorded here.

## Current phase

**Phase 1 — Repository Intelligence** (Phase 0 signed off by human, amit13091992@gmail.com)

## Current milestone

Phase 1 deliverable per `docs/tasks/phase-1-repository-discovery.md` is **complete**:
`RepositoryDiscoverer` implemented in `@code-analyzer/project-model`, verified end-to-end through
the real `ScanEngine`/`AnalyzerClient` lifecycle. Awaiting human review before starting Phase 2.

## Completed components

- Monorepo scaffold: pnpm workspaces, `tsconfig.base.json`, 10 package boundaries created (`core`,
  `project-model`, `parser`, `graph`, `analyzers`, `engines`, `integrations`, `ai`, `plugins`, `cli`).
- `@code-analyzer/core` domain model: `Project`, `Repository`, `File`, `Module`, `Symbol`, `Function`,
  `Class`, `Dependency`, `Endpoint`, `DatabaseEntity`, `Service`, `SecurityBoundary`, `DataFlow`,
  `Evidence`, `Finding`, `Scan` — see `packages/core/src/domain/`.
- Core contracts: `Analyzer`, `AnalyzerContext`, `AnalysisResult`, `Graph`, `AnalyzerPlugin`,
  `ScanOptions`, `ScanResult`, `AnalyzerConfig` — see `packages/core/src/`.
- `ScanEngine` / `AnalyzerClient`: a working (not stubbed-out) orchestrator implementing the
  initialize → discover → index → analyze → correlate → finalize lifecycle, driven by pluggable
  `RepositoryDiscoverer` / `ProjectIndexer` / `FindingCorrelator` / `RiskCalculator` strategies.
  Covered by `tests/core/scan-engine.test.ts` (3 passing tests) using fixture strategies — no real
  discovery/parsing exists yet, which is correct for Phase 0.
- Event model (`ScanEvent` union), error/diagnostic model, structured logging contract.
- ADRs: see `docs/decisions/`.
- `.claude/` development-agent configuration: `CLAUDE.md`, agents, skills, commands.
- `RepositoryDiscoverer` (`@code-analyzer/project-model`, Phase 1): filesystem walk with
  `.gitignore` handling (`src/walk.ts`), file classification into `SourceClassification`/
  `LanguageId` (`src/classify.ts`), binary detection (`src/binary.ts`), content hashing
  (`src/hash.ts`), package-manager + pnpm/npm/yarn workspace detection (`src/package-manager.ts`),
  and framework detection for Section 5's initial list (`src/frameworks.ts`). Wired together in
  `src/discover.ts` as `projectModelDiscoverer`, exported from the package's `index.ts`.
  See ADR-0005.
- 6 fixture repositories under `fixtures/project-model/` (node-express/npm, nestjs-app/pnpm,
  nextjs-app/yarn, react-native-app/bun, monorepo-pnpm with 2 workspace packages, generated-code
  exercising every `SourceClassification`) with 12 passing tests: 7 fixture-classification tests
  plus a determinism test (`tests/project-model/discover.test.ts`), and 2 true end-to-end tests
  running real discovery through the actual `AnalyzerClient.scan()` lifecycle with a real
  `Analyzer` reading `context.project.files` (`tests/project-model/end-to-end.test.ts`).
- CLI & reporting (`docs/tasks/cli-and-reporting.md`, ADR-0007): `json`/`sarif`/`html`
  `ResultExporter` implementations in `@code-analyzer/cli/src/exporters/`; `code-analyzer scan
  <root>` (real Phase 1 discovery → whatever analyzers are registered, zero today) and
  `code-analyzer export` (re-format a prior `ScanResult`) commands with a hand-rolled argument
  parser (`src/args.ts`) and a `bin` entry point (`src/bin.ts`); an `InMemoryAnalyzerRegistry`
  wiring helper. 17 new tests across `tests/cli/` (exporters incl. an HTML-injection-escaping test,
  scan/export command success and failure paths, argument parsing). Manually verified against the
  built `dist/bin.js` running real scans over `fixtures/project-model/`.

## In-progress components

None — Phase 1 and the CLI & Reporting task are both complete, pending human review.

## Blocked components

None.

## Known architectural decisions

- See `docs/decisions/ADR-0001-monorepo-package-architecture.md` through `ADR-0007`.
- Notably: the `Analyzer` name collision between the Section 37C rule contract and the Section 3
  facade class is resolved by naming the facade `AnalyzerClient` (ADR-0002).
- Repository discovery implementation choices (symlinks never followed, classification priority
  order, minimal workspace-glob support, `FileId` = relative path, no YAML dependency for
  `pnpm-workspace.yaml`): ADR-0005.
- CLI reporting exporters live in `@code-analyzer/cli` (not `@code-analyzer/integrations`, which is
  reserved for ingesting external tool output — the opposite direction); no CLI framework
  dependency yet: ADR-0007.

## Known technical debt

- Stub packages (`parser`, `graph`, `analyzers`, `engines`, `integrations`, `ai`, `plugins`, `cli`)
  still contain only `package.json` + empty `src/index.ts` — intentional, gated on their own phase.
- Workspace glob expansion only supports an exact path or a trailing `/*` — no `**`/brace patterns
  (ADR-0005). Revisit against a real fixture that needs it.
- No persistent cache/incremental-analysis implementation yet (`IncrementalConfig` is a contract
  only) — Section 29 work, not required by the Phase 1 task spec.
- Reasoning provider abstraction (`ReasoningProviderConfig`) has no concrete provider yet — planned
  for `packages/ai` once deterministic analyzers exist to feed it (Section 24).
- Discovery does not yet populate `ProjectModel.dependencies` (Section 13's `Dependency[]`) —
  deliberately deferred per ADR-0005 until vulnerability/reachability data sources exist.
- `code-analyzer scan` legitimately produces zero findings today — `@code-analyzer/analyzers` has
  no analyzers registered yet (intentional per `docs/tasks/cli-and-reporting.md` Non-goals).
- SARIF export is verified by structural assertions against the fields we emit, not full SARIF
  2.1.0 schema validation (ADR-0007) — strengthen before relying on it in a real CI/CD adapter.
- No `--fail-on <severity>` CI-gating exit code on `scan` yet (deferred, cheap follow-up).
- No `explain`/`graph`/`endpoints`/`dependencies` CLI subcommands yet — each needs data from a
  later phase (finding lookup, the graph, the endpoint/dependency models).

## Next approved tasks

Phase 1 (`docs/tasks/phase-1-repository-discovery.md`) is implemented and tested — pending human
review/sign-off before Phase 2 begins.

`docs/tasks/phase-2-ast-semantic-model.md` is **drafted, not approved to start** — same gate Phase 1
went through: it's visible for review now, but Phase 2 implementation should not begin until Phase 1
is signed off and this spec (including the TypeScript-compiler-API-vs-Tree-sitter decision it
proposes as ADR-0006) is explicitly approved.

`docs/tasks/cli-and-reporting.md` is **implemented and tested** (ADR-0007 approved by
amit13091992@gmail.com) — pending human review, same as Phase 1, before being wired into any CI/CD
adapter or published to npm.
