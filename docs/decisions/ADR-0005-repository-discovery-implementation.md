# ADR-0005: Repository Discovery Implementation (Phase 1)

## Status

Accepted

## Context

`docs/tasks/phase-1-repository-discovery.md` required implementing `RepositoryDiscoverer`
(`packages/core/src/analyzer/pipeline.ts`) in `@code-analyzer/project-model`: filesystem walk with
ignore handling, file classification, package-manager/workspace detection, and framework detection,
producing a `ProjectModel` with `repository`, `files`, and `frameworks` populated.

## Decision

- **Dependency**: added `ignore` (the same `.gitignore`-semantics parser used by ESLint, ts-node,
  and most JS tooling) as a dependency of `@code-analyzer/project-model` only — not `core`, per
  CLAUDE.md's dependency policy ("new third-party dependencies need a stated reason... `core` in
  particular should stay minimal"). Reason: correct `.gitignore` pattern matching (negation,
  directory-only patterns, `**` globs) is non-trivial and already-solved; hand-rolling it risks
  subtly wrong ignore behavior on repositories we don't control (Section 31: repository content is
  untrusted input).
- **Symlinks are never followed** during the walk — Section 31 treats repository content as hostile
  input, and following a symlink risks escaping the repository root onto the host filesystem.
  `.git` and `node_modules` are always skipped regardless of `.gitignore` content, since discovery
  must not depend on a possibly-malformed or missing `.gitignore` to avoid walking into them.
- **Classification is priority-ordered** (`packages/project-model/src/classify.ts`): generated >
  vendored > infrastructure > test > documentation > asset > config > source > unknown. A file
  matching multiple heuristics (e.g. a generated test fixture) is classified by the first rule that
  matches, chosen so the most operationally significant classification (generated/vendored, which
  affects whether findings should even be trusted) wins over a merely descriptive one (test).
- **Workspace glob support is intentionally minimal**: only an exact path or a trailing `/*` glob
  (e.g. `packages/*`) is expanded, by listing that directory's immediate children. Full glob syntax
  (`**`, brace expansion) was not implemented — Section 30's fixture list only requires a
  single-level workspace layout, and a hand-rolled partial glob implementation is worse than an
  honest, documented limitation. Extend this only against a real fixture that needs it, not
  speculatively.
- **`FileId` is the file's repository-relative path**, not a hash or UUID. It's already unique
  within a project, stable across re-discovery runs (required for the determinism test in
  `tests/project-model/discover.test.ts`), and human-readable in `Evidence.locations`/`Finding`
  output.
- **No YAML library dependency** for reading `pnpm-workspace.yaml`: a ~15-line line-based extractor
  reads just the `packages:` list, which is all Phase 1 needs. A full YAML parser is deferred to
  wherever Section 5's general YAML language support actually gets implemented (Phase 2+), so this
  isn't a permanent decision — just not worth pulling in a dependency for one field today.

## Alternatives considered

- **Follow symlinks with a visited-set cycle guard.** Rejected: the security cost (potential
  filesystem escape) outweighs the completeness benefit for Phase 1; revisit only if a real
  repository fixture needs it, with an explicit sandboxed-root check.
- **Full minimatch/glob dependency for workspace patterns.** Rejected for now — YAGNI given the
  actual fixture set (ADR pattern established in ADR-0003/35.7: don't add complexity speculatively).
  If Phase 1 fixtures grow to need `**`/brace patterns, add `minimatch` or `fast-glob` then, with a
  stated reason per CLAUDE.md's dependency policy.
- **Compute `Dependency[]` (Section 13) during discovery**, since `package.json` is already parsed.
  Deferred: `Dependency` requires vulnerability/reachability data this phase has no source for
  (ADR-0004: don't populate a field with a value that implies more than what's known). Discovery
  only extracts framework-detection signal from dependency *names*, not full `Dependency` entities.

## Consequences

- `packages/project-model/src/package-manager.ts`'s workspace-glob expansion will need revisiting
  (new ADR, not a silent extension) if a future fixture requires nested or brace-expanded globs.
- Any change to the classification priority order is a behavior change for every downstream
  analyzer that filters on `SourceClassification` — update
  `tests/project-model/discover.test.ts`'s fixture assertions in the same change.
- `fixtures/project-model/generated-code/dist/` required a scoped negation in the root
  `.gitignore` (`!fixtures/project-model/generated-code/dist/**`) so the fixture's intentionally
  committed build output isn't swallowed by the repo's own `dist/` ignore rule — a reminder that
  fixtures which need to commit normally-ignored file shapes must negate narrowly, not broadly.
