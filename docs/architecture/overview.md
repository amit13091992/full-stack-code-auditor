# Architecture Overview

## Pipeline

```
Repository
  -> Repository Discovery         (packages/project-model, Phase 1)
  -> Normalized Project Model     (ProjectModel, packages/core/src/domain/project.ts)
  -> AST / Syntax Model           (packages/parser, Phase 2, internal detail)
  -> Symbol Model                 (Symbol/Module, packages/core/src/domain, Phase 2)
  -> Module Graph / Symbol Graph  (packages/graph, Phase 3, implemented)
  -> Dependency Graph             (packages/graph, blocked on Section 13's Dependency[] — see Known Gaps)
  -> Call Graph                   (packages/graph, Phase 4)
  -> Data-Flow / Taint Graph      (packages/graph, Phase 5)
  -> API Model                    (EndpointModel, Phase 1-plus framework adapters)
  -> Database Model               (DatabaseEntity, Phase 1-plus ORM adapters)
  -> Infrastructure Model         (Section 15, not yet modeled as a domain type — see Known Gaps)
  -> Application Knowledge Graph  (packages/graph "applicationGraph", Section 16)
  -> Analysis Engines             (packages/analyzers, packages/engines)
  -> Evidence                     (Evidence, packages/core/src/domain/evidence.ts)
  -> Finding Correlation          (packages/engines, Section 21)
  -> Risk Assessment              (packages/engines, Section 22)
  -> Optional AI Investigation    (packages/ai, Section 24, strictly optional)
  -> Verified Result              (ScanResult, packages/core/src/serialization/scan-result.ts)
```

Every arrow above is a typed contract in `packages/core`, not a convention. An analyzer never skips
a stage (e.g. an analyzer must not parse a file itself instead of reading `ProjectModel`) — see
`docs/analyzer-engine/lifecycle.md`.

## Package dependency direction

```
core  <---  project-model, parser, graph, analyzers, engines, integrations, ai, plugins, cli
```

`core` depends on nothing else in the workspace. No other package may be imported by `core`. This is
enforced by `core`'s `package.json` having zero `@code-analyzer/*` dependencies — see ADR-0001.

## Known gaps as of Phase 3

- Infrastructure Model (Section 15: Docker/K8s/Terraform/GitHub Actions/Nginx/cloud config) has no
  domain type yet. It was intentionally left out of the Section 37B list to implement — it will be
  added when `packages/analyzers`' infrastructure category is scoped (see `docs/tasks/`).
- `ServiceEntity`/`SecurityBoundary` (Section 16) exist as domain types but the Architecture Rule
  DSL (the YAML `rules:` block in Section 16) has no parser yet — that is Phase 6+ work, not Phase 0.
- Runtime/DAST sandbox (Section 26, Section 31) is not modeled at all yet beyond `SandboxConfig` in
  `AnalyzerConfig`. It is a distinct execution environment, not a package boundary decision to make
  in Phase 0.
- Dependency Graph (`DEPENDS_ON` edges) is blocked on `ProjectModel.dependencies` actually being
  populated (Section 13, deferred since Phase 1's ADR-0005) — see `docs/project-status.md`.
- `REFERENCES` edges (Symbol Graph) are blocked on Phase 2 not collecting symbol-occurrence data
  yet — declarations only, not every place a symbol is used. See `docs/graph/overview.md`.

## Where to look for detail

- Domain model: `docs/domain-model/overview.md`
- Analyzer lifecycle: `docs/analyzer-engine/lifecycle.md`
- Graph model: `docs/graph/overview.md`
- Parser boundary: `docs/parser/overview.md`
- Security subsystem shape: `docs/security/overview.md`
- Testing approach: `docs/testing/strategy.md`
- Why things are named/shaped the way they are: `docs/decisions/`
