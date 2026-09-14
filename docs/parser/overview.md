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

## What Phase 2 must decide (not decided in Phase 0)

- Tree-sitter vs. TypeScript compiler API vs. both, per language (Section 4: "mature parsers...
  especially Tree-sitter and/or language-native parsers").
- Incremental re-parse strategy (Section 2: "incremental parsing where possible") and how it
  interacts with the Section 29 incremental-scan cache.
- Symbol resolution strategy for genuinely dynamic JS (Section 4's call graph `dynamic`/`unknown`
  certainty exists specifically because this can't always be fully resolved statically).

Do not start implementing `packages/parser` until a `docs/tasks/phase-2-*.md` task spec exists and
is approved (Section 50/51).
