# Parser Boundary

Section 2 treats the AST as an implementation detail: "Expose a normalized semantic model to
analyzer authors." No package outside `packages/parser` (and internally, `packages/project-model`
during discovery) is allowed to import a parser (Tree-sitter, TypeScript compiler API, etc.)
directly. Analyzers consume `Module`, `Symbol`, `FunctionEntity`, `ClassEntity` from
`packages/core/src/domain` — never a raw AST node.

## What Phase 0 fixes (so Phase 2 has a target to build toward)

- `SourceLocation` / `SourceRange` / `SourcePosition` (`packages/core/src/domain/ids.ts`) — the one
  shape every parser adapter must normalize its own AST node positions into.
- `Symbol`, `SymbolReference`, `ImportBinding`, `ExportBinding` (`symbol.ts`) — declaration vs.
  reference distinction is explicit (Section 2 requirement), not inferred by callers.
- `ParseError` (`packages/core/src/errors/errors.ts`) — syntax-error tolerance (Section 2) means a
  parse failure on one file is a `Diagnostic`, not a thrown exception that aborts the whole scan.

## Phase 2: implemented

`docs/decisions/ADR-0006-parser-choice-and-id-scheme.md` (Accepted) settled parser technology
(TypeScript Compiler API, not Tree-sitter, for JS/TS), the entity ID scheme (deterministic
`(modulePath, kind, name, declaration offset)`), and scope (per-file only — cross-file import
resolution is Phase 3's Module Graph job). `@code-analyzer/parser` implements this:
`parse-file.ts` (the pure per-file parse), `ids.ts`, `location.ts`, `project-indexer.ts` (the
`ProjectIndexer` composing it over every eligible `SourceFile`). See `docs/project-status.md` for
current test/fixture coverage. Tree-sitter remains the documented fallback for a future language
with no compiler-API equivalent.

## Still undecided (out of Phase 2's scope, not forgotten)

- Incremental re-parse strategy (Section 2: "incremental parsing where possible") and how it
  interacts with the Section 29 incremental-scan cache.
- Symbol resolution strategy for genuinely dynamic JS (Section 4's call graph `dynamic`/`unknown`
  certainty exists specifically because this can't always be fully resolved statically) — Phase 4's
  concern once a call graph exists to apply it to.
- How `ParseError`/`Diagnostic`s produced during parsing reach `ScanResult.diagnostics` —
  `ProjectIndexer.index()` currently has no return channel for them (flagged in
  `packages/parser/src/project-indexer.ts` and `docs/project-status.md`'s technical debt list).
