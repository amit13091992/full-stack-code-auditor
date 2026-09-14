# code-analyzer

Application-aware full-stack codebase analyzer. Not a linter — an engine that builds a normalized
model of a repository (code, symbols, graphs, APIs, data flow, dependencies, architecture,
infrastructure) and lets deterministic analyzers and an optional AI layer reason over that model.

## Vision (read `docs/architecture/overview.md` for the full pipeline)

`Repository -> ProjectModel -> AST/Symbol Model -> Graphs (module/dependency/call/taint) -> API/DB/
Infra Models -> Application Graph -> Analyzers -> Evidence -> Finding Correlation -> Risk -> optional
AI investigation -> ScanResult`. The core analyzer must work fully without any AI provider — AI is
an optional layer on top, never the primary detection mechanism.

## Package boundaries

`packages/core` has zero dependencies on other workspace packages and contains no analysis logic —
only domain model, contracts, and the `ScanEngine` lifecycle. Every other package (`project-model`,
`parser`, `graph`, `analyzers`, `engines`, `integrations`, `ai`, `plugins`, `cli`) depends on `core`
and never reaches into another package's `src/` internals — only its exported contracts. See
ADR-0001 (`docs/decisions/`) before adding or merging a package.

## Current phase

**Phase 0 — Foundation & Contracts.** Check `docs/project-status.md` before starting substantial
work — it is the source of truth for what phase we're in and what's approved to build next. Do not
decide unilaterally that the project has advanced to the next phase.

## Supported languages / frameworks (initial)

JavaScript, TypeScript, JSON, YAML, SQL, Dockerfile. Frameworks: React, React Native, Node.js,
Express, NestJS, Next.js. Additional languages plug in without redesigning `core` — see
`docs/parser/overview.md`.

## Coding standards

- TypeScript `strict: true` (see `tsconfig.base.json`) — `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess` are on; write code that satisfies them rather than widening types to
  work around them.
- Every domain entity field is `readonly`; entities are immutable (see `docs/domain-model/overview.md`).
- No comments explaining *what* code does; only *why*, and only when non-obvious.
- Small, verifiable changes over large speculative ones (Section 52). Don't implement functionality
  a phase doesn't require unless it's establishing a contract a later phase genuinely needs
  (Section 35.13).
- Uncertainty is representable, never hidden (ADR-0004): don't default an "unknown" field to a
  value that implies a conclusion.

## Security requirements

The analyzer processes untrusted repository content. Never execute scanned repository code in the
main process; runtime/DAST analysis is sandboxed and isolated (Section 31, `docs/security/overview.md`).
Changes touching authentication, authorization, taint, secrets, sandboxing, or external tool
execution require the enhanced review path in `docs/security/overview.md` — implementation → unit
tests → security fixtures → regression tests → architecture review → security review.

## Performance requirements

Prefer deterministic analysis; profile before introducing complexity (e.g. a native/Rust worker) —
don't add it speculatively (Section 4). Incremental analysis (changed files → affected graph nodes
→ affected findings) is a Phase 1+ requirement, not optional — design new graph/cache structures
with it in mind (Section 29).

## Dependency policy

New third-party dependencies need a stated reason in the PR/commit description. `packages/core`
in particular should stay minimal — it is the one package every other package (and every consumer)
transitively depends on.

## Git conventions

Conventional, imperative commit subjects (`add`, `fix`, `refactor`, not `added`/`fixes`). One
logical change per commit. Do not commit `.env`, credentials, or anything under `.claude/` that
would expose a secret (Section 56).

## Documentation requirements

Update `docs/project-status.md` when a component moves from in-progress to completed. Write an ADR
(`docs/decisions/ADR-NNNN-*.md`, format: Context/Decision/Alternatives/Consequences/Status) for any
decision that changes a contract another package depends on, per Section 43/46.

## How to run things

```bash
pnpm install
pnpm build        # tsc -b across all packages
pnpm typecheck
pnpm test          # vitest run
pnpm test:watch
```

## How to extend the platform

- **Add an analyzer**: implement the `Analyzer` interface (`packages/core/src/analyzer/analyzer.ts`)
  in `packages/analyzers`, register it against an `AnalyzerRegistry`. See
  `.claude/skills/analyzer-development/SKILL.md`.
- **Add a graph relationship**: extend `EdgeRelationType` in `packages/core/src/graph/graph.ts` only
  via ADR (it's a frozen enum consumed by every graph builder) — see
  `.claude/skills/graph-analysis/SKILL.md`.
- **Add a finding**: construct a `Finding` + `Evidence` pair per ADR-0004 — see
  `.claude/skills/security-analysis/SKILL.md` for the security-specific version.
- **Add a plugin**: implement `AnalyzerPlugin` (`packages/core/src/plugin/plugin.ts`) — identical
  shape to `Analyzer` plus install metadata.

## Deeper documentation (do not duplicate this content here)

`docs/architecture/`, `docs/domain-model/`, `docs/analyzer-engine/`, `docs/graph/`, `docs/parser/`,
`docs/security/`, `docs/testing/`, `docs/decisions/`, `docs/project-status.md`, `docs/tasks/`.
