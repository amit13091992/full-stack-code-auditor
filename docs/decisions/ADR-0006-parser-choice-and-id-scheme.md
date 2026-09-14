# ADR-0006: TypeScript Compiler API for Parsing, Deterministic Symbol IDs, Per-File Scope

## Status

Accepted (amit13091992@gmail.com)

## Context

`docs/tasks/phase-2-ast-semantic-model.md` needs three decisions `docs/parser/overview.md`
explicitly left open before `@code-analyzer/parser` can be implemented: which parser technology to
use, how entity IDs are generated, and whether this phase resolves imports across files.

## Decision

- **Parser: the TypeScript Compiler API** (`typescript` package, `allowJs: true`), used for both
  `.js`/`.jsx` and `.ts`/`.tsx` files — not Tree-sitter. Section 2 requires real symbol identity and
  declaration/reference distinction, not just a concrete syntax tree; `ts.createSourceFile` +
  `ts.createProgram` give a real binder on day one. Tree-sitter remains the documented option for a
  future non-JS/TS language where no compiler-API equivalent exists.
- **IDs are deterministic**, derived from `(modulePath, kind, name, declaration start offset)` via
  `moduleId(path) = path`, `symbolId(path, kind, name, offset) = "${path}#${kind}:${name}@${offset}"`
  (and similarly for `FunctionId`/`ClassId`, scoped under their owning symbol's id). Re-parsing
  unchanged content yields byte-identical IDs — same discipline as `FileId` = relative path
  (ADR-0005), needed for stable fixture tests now and incremental-analysis caching later
  (Section 29).
- **Per-file only.** Every `ImportBinding.resolvedModuleId` stays `undefined` this phase
  (ADR-0004's uncertainty-preservation rule) — resolving an import specifier to another file's
  `Module` needs to see the whole project, which is Phase 3's Module Graph.
- **Which files parse**: `SourceFile`s with `language` in `{javascript, typescript}` and
  `classification` not in `{generated, vendored, asset}` (Phase 1 output, unchanged).
- **A parse failure never aborts the run**: caught per-file, converted to `ParseError`
  (`packages/core/src/errors/errors.ts`), recorded as a `Diagnostic`; every other file still parses.

## Alternatives considered

- **Tree-sitter for JS/TS.** Rejected for this phase: would need a second, hand-built resolution
  layer on top of the CST to get symbol identity, duplicating what the TS compiler API already
  provides. Tree-sitter's real advantage (uniform grammar-based parsing across many languages with
  no compiler dependency) matters once a non-JS/TS language is in scope — not yet (Section 5).
- **Random UUIDs for entity IDs.** Rejected: breaks the determinism Phase 1 already established and
  needed for stable fixture assertions and future incremental caching (Section 29) — a re-parse of
  unchanged content must not look like "everything changed" to a cache.
- **Resolving imports to `Module`s in this phase**, since the TS compiler API's `Program` can do
  module resolution. Rejected: conflates "parse this file" with "build the module graph" — two
  different pipeline stages (Section 2). Doing it here would also require constructing a full
  `ts.Program` across the whole project up front, which is heavier and less incremental-friendly
  than Phase 3's dedicated graph-construction step.

## Consequences

- `@code-analyzer/parser`'s only new dependency is `typescript` itself — already a devDependency
  everywhere in this monorepo, now also a runtime dependency of `parser`.
- The TS compiler API is used strictly for parsing/binding, never to transpile-and-execute scanned
  code (Section 31) — enforced by only calling `ts.createSourceFile`, never `ts.transpileModule`
  followed by execution, and never running a real `tsc` build of the target repository.
- Phase 3 (Module Graph) is responsible for turning each file's raw `ImportBinding.specifier` into
  a `resolvedModuleId` by matching against the full `ProjectModel.modules` list — this phase's
  parser output is deliberately incomplete in that one respect, not a bug to fix here.
- If a future language has no compiler-API equivalent, Tree-sitter gets introduced then, behind the
  same `Module`/`Symbol`/`FunctionEntity`/`ClassEntity` contracts — this ADR does not block that.
