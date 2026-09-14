# ADR-0002: Normalized Project Model and the `Analyzer` Naming Collision

## Status

Accepted

## Context

Section 2 requires a `ProjectModel` that every analyzer reads from instead of parsing files
directly. Section 37C separately requires a TypeScript interface literally named `Analyzer` (the
per-rule contract), while Section 3's usage example shows a class also called `Analyzer`:

```ts
import { Analyzer } from '@code-analyzer/core';
const analyzer = new Analyzer({ root: './project', profile: 'full' });
```

These are two different concepts — a facade users instantiate, and a contract that rule/engine
authors implement — that the source spec happens to give the same name.

## Decision

1. **ProjectModel** (`packages/core/src/domain/project.ts`) aggregates `Repository`, `SourceFile[]`,
   `Module[]`, `Symbol[]`, `FunctionEntity[]`, `ClassEntity[]`, `Dependency[]`, `EndpointModel[]`,
   `DatabaseEntity[]`, `ServiceEntity[]`, `SecurityBoundary[]`, and detected `FrameworkId[]`. It is
   immutable once built by a `RepositoryDiscoverer` + `ProjectIndexer` pair (see
   `packages/core/src/analyzer/pipeline.ts`). Analyzers receive it read-only via
   `AnalyzerContext.project`.

2. **Naming collision resolved by splitting the concepts under different names:**
   - `Analyzer` (interface, `packages/core/src/analyzer/analyzer.ts`) — the contract every rule and
     engine implements: `id`, `capabilities`, `supports(context)`, `analyze(context)`. This is the
     name Section 37C explicitly asks for.
   - `AnalyzerClient` (class, `packages/core/src/analyzer/client.ts`) — the facade end users
     instantiate (`new AnalyzerClient({ config, registry, strategies })`), matching the Section 3
     usage pattern. `packages/cli` re-exports this as the CLI's own `Analyzer` binding at its own
     boundary, so `import { Analyzer } from '@code-analyzer/cli'` reads exactly like the Section 3
     example without the two concepts colliding inside `core`'s own export surface.

## Alternatives considered

- **Name the facade `Analyzer` and rename the rule contract** (e.g. `AnalyzerRule`,
  `AnalysisEngine`). Rejected: Section 37C is explicit that the interface is named `Analyzer`, and
  "rule contract" is the concept referenced throughout Sections 7, 17, 18, 27 (`AnalyzerPlugin`
  extends it) — renaming it would ripple through more of the spec's vocabulary than renaming the
  facade does.
- **Merge them into one class-shaped interface** (an `Analyzer` that is both instantiable and
  implementable). Rejected: conflates "thing you configure and run a scan with" with "thing you
  implement to contribute findings" — different lifecycles, different authors (platform vs. plugin
  authors), different stability guarantees.

## Consequences

- `@code-analyzer/core`'s public surface exports both `Analyzer` (interface) and `AnalyzerClient`
  (class) with no collision, since one is a type and the other a value, but consumers who want the
  Section-3-shaped `new Analyzer(...)` ergonomics get it via `@code-analyzer/cli`'s re-export.
- Any future Section 37C-style spec text that says "the `Analyzer` interface" refers to the rule
  contract; any future text quoting `new Analyzer(...)` refers to `AnalyzerClient` (or its CLI-level
  alias). Agents must not silently rename either without updating this ADR.
