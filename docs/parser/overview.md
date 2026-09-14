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

**Both module systems are covered**, not just ES modules: `parse-file.ts` also recognizes CommonJS
`require()` (as `ImportBinding`s — `default` for `const x = require(...)`, `named` for
`const { a, b } = require(...)`, `side-effect` for a bare `require(...)` statement) and
`module.exports`/`module.exports.foo`/`exports.foo` (as `ExportBinding`s). This reuses the existing
`ImportKind`/`ExportKind` values — no core contract change — and required zero changes to
`buildModuleGraph` (`packages/graph`), since it only ever reads `ImportBinding.specifier`,
regardless of which module system produced it. Genuinely legacy, pre-ESM Node.js code is covered.

## Python: implemented (ADR-0009)

A second language, `LanguageId: "python"`, parsed via **Tree-sitter** (`tree-sitter` +
`tree-sitter-python`) — this is exactly the fallback ADR-0006 reserved for a language with no
TypeScript-Compiler-API equivalent. `packages/parser/src/python/parse-python-file.ts` mirrors
`parse-file.ts`'s scope as closely as Python's grammar allows: top-level `def`/`class` only,
per-file only, same deterministic-ID discipline, same "never throws on a syntax error" tolerance
(a `hasError` tree becomes a `Diagnostic`). `parserProjectIndexer` dispatches by `file.language`.

**Important asymmetry with JS/TS, verified not assumed**: the Symbol Graph (`DECLARES`/`EXTENDS`/
`IMPLEMENTS`) works over Python output with zero `packages/graph` changes — it's entity-shape-based,
not language-based. The **Module Graph does not** — `buildModuleGraph`'s specifier resolution is
JS-relative-path-specific and produces zero edges for Python's dotted-module `import` statements.
Extending it for Python needs its own resolution algorithm; see `docs/project-status.md`'s
technical debt.

## Still undecided (out of Phase 2's scope, not forgotten)

- Incremental re-parse strategy (Section 2: "incremental parsing where possible") and how it
  interacts with the Section 29 incremental-scan cache.
- Symbol resolution strategy for genuinely dynamic JS (Section 4's call graph `dynamic`/`unknown`
  certainty exists specifically because this can't always be fully resolved statically) — Phase 4's
  concern once a call graph exists to apply it to.
- How `ParseError`/`Diagnostic`s produced during parsing reach `ScanResult.diagnostics` —
  `ProjectIndexer.index()` currently has no return channel for them (flagged in
  `packages/parser/src/project-indexer.ts` and `docs/project-status.md`'s technical debt list).
