# ADR-0013: `ScanProfile` Filters Analyzers by `AnalyzerCategory`

## Status

Accepted (amit13091992@gmail.com)

## Context

`ScanProfile` (`packages/core/src/domain/scan.ts`) has five values — `minimal`, `standard`,
`security`, `full`, `enterprise` — surfaced end-to-end: `AnalyzerConfig.profile`,
`ScanOptions.profile`, the CLI's `--profile` flag (`packages/cli/src/commands/scan.ts`), and
`ScanResult.scan.profile`. Until now it was purely descriptive metadata: `ScanEngine.scan()`
(`packages/core/src/analyzer/engine.ts`) recorded it on the result and emitted it on
`scan:started`, but the analyzer-selection branch it feeds into ran `this.registry.list()`
unconditionally whenever the caller didn't pass an explicit `analyzers` id list — every profile
ran every registered analyzer. A user running `--profile minimal` and `--profile enterprise`
against the same repo got byte-identical findings, which is a real functional gap between the
documented flag (README's flag table implies profiles change scope) and actual behavior — reported
by a user who noticed both commands gave the same output.

### Consumers inspected (Section 46)

Grepped `ScanProfile`/`options.profile`/`config.profile`/`registry.list()` across `packages/*/src`:

- `packages/core/src/analyzer/engine.ts` — `ScanEngine.scan()`, the only place analyzer selection
  happens (this change).
- `packages/cli/src/commands/scan.ts` — passes `profile` into `AnalyzerConfig` via `buildConfig()`,
  never sets `ScanOptions.analyzers`; benefits automatically once the engine filters by category.
- `packages/api/src/scan/run-scan.ts` — same shape, also never sets `analyzers`; same automatic
  benefit, no `packages/api` code change needed.
- `tests/core/scan-engine.test.ts`, `tests/cli/scan-command.test.ts` — existing tests construct
  fixture analyzers/registries; audited below for whether any assumed "profile runs everything."
- `AnalyzerCategory` (`packages/core/src/analyzer/analyzer.ts`) already has 7 values; only three
  (`architecture`, `quality`, `secrets`) have a shipped analyzer today (ADR-0010's Track A/B1 plus
  the first graph analyzers task) — `security`, `performance`, `dependency`, `infrastructure` are
  reserved for work already scoped in ADR-0010 but not yet built.

No other package reads `ScanProfile` or calls `AnalyzerRegistry.list()`/`listByCategory()`.

## Decision

- **New module `packages/core/src/analyzer/profiles.ts`** exports one constant,
  `PROFILE_CATEGORIES: Readonly<Record<ScanProfile, readonly AnalyzerCategory[]>>`, mapping each
  profile to the categories it runs:
  - `minimal`: `["architecture"]` — the fastest, purely-structural check (no source-text scanning,
    no per-function metrics).
  - `standard`: `["architecture", "quality"]` — adds the quality rules for everyday CI use.
  - `security`: `["security", "secrets"]` — everything security-relevant, including the
    not-yet-built `security` (SAST) category so it activates automatically once Phase 5 ships
    rules into it, with no profile-mapping change needed then.
  - `full` / `enterprise`: all seven `AnalyzerCategory` values. They are identical today —
    `enterprise` has no analyzer-selection behavior beyond `full` yet; kept as a distinct profile
    value (not collapsed into `full`) because `ScanProfile` is a public contract already consumed
    by the CLI's `--profile` flag and `ScanResult.scan.profile`, and enterprise-tier behavior
    (e.g. a stricter sandbox, mandatory reasoning-provider checks) is plausible future scope for
    that value specifically, not something to design now (Section 35.13).
- **`ScanEngine.scan()`'s analyzer-selection branch** (previously `: this.registry.list()`) becomes
  `: this.registry.list().filter((a) => PROFILE_CATEGORIES[profile].includes(a.capabilities.category))`.
  An explicit `analyzers` id list (`ScanOptions.analyzers` or `AnalyzerConfig.analyzers`) still
  takes precedence over profile-based selection entirely, unchanged from before this ADR — naming
  specific analyzer ids is an explicit opt-out of profile scoping, not a second filter stacked on
  top of it.
- No change to `ScanProfile`, `AnalyzerCategory`, `AnalyzerConfig`, or `ScanOptions` themselves —
  only to how `ScanEngine.scan()` interprets an already-existing field it was already storing.

## Alternatives considered

- **Filter in the CLI/API layer instead of `ScanEngine`.** Rejected: both `packages/cli` and
  `packages/api` construct their own `AnalyzerRegistry` and call `client.scan()` the same way: this
  would require duplicating the same category-filter logic in both packages (and any future
  caller), instead of once in the shared engine both already depend on (Section 3/37D's stated
  reason `ScanEngine` exists at all).
- **A configurable/pluggable profile→category mapping** instead of a fixed constant. Rejected for
  now (Section 35.13) — no caller has asked for custom profiles, and `AnalyzerConfig.analyzers`
  already provides a full escape hatch (explicit id list) for any caller that needs a selection the
  five fixed profiles don't cover.

## Consequences

- `--profile minimal` and `--profile full`/`enterprise` (or the equivalent `ScanOptions.profile`)
  now produce different `analyzersRun`/`findings` over the same repository, matching what the flag
  already claimed. `--profile security` runs `secrets/pattern-scan` only today (no `security`-
  category analyzer exists yet) — a real, correctly-scoped result, not a bug.
  `packages/cli`/`packages/api` needed zero code changes to pick this up, confirming the "filter
  once in the engine" choice above.
- A repository scanned with the (still-default) `minimal` profile now sees only
  `architecture/circular-import` and `architecture/unresolved-import` run, not all 8 analyzers —
  callers relying on `minimal`'s old (undocumented, accidental) "run everything" behavior need
  `--profile full` or an explicit `--analyzers` list instead. No known caller depended on this
  (confirmed by the consumer grep above), and the old behavior was never documented as correct.
- Adding a new analyzer in an already-covered category (e.g. a second `quality` rule) needs no
  `PROFILE_CATEGORIES` change. Adding the *first* analyzer in `performance`, `dependency`, or
  `infrastructure` likewise needs no change — `full`/`enterprise` already list those categories.
  Only a genuinely new `AnalyzerCategory` value would need this file updated, same as today's
  `AnalyzerCategory` union itself.
