# ADR-0009: Angular/Vue Framework Detection, Python as a Second Language

## Status

Accepted (amit13091992@gmail.com)

## Context

A user capability question ("can this scan Angular, .NET, PHP, Java, Python, ... repos?") surfaced
two real gaps: Section 5's framework list didn't include Angular or Vue even though both are
TypeScript/JavaScript-ecosystem frameworks the existing parser already handles at the syntax level,
and Section 5's language list had no non-JS/TS language at all — every `.py`/`.cs`/`.php`/`.java`
file was tagged `language: "unknown"` with zero semantic model. The user asked for Angular, Vue,
and Python specifically.

## Decision

- **`FrameworkId` gains `"angular"` and `"vue"`** (`packages/core/src/domain/project.ts`). Both are
  detected the same way as the existing five frameworks: presence of `@angular/core` /
  `vue` in a workspace package's `dependencies`/`devDependencies`
  (`packages/project-model/src/frameworks.ts`). No parser changes needed — Angular/Vue `.ts`/`.js`
  files already parse correctly as plain TypeScript/JavaScript (decorators, classes, etc.); this is
  purely a detection-layer addition. `.vue` single-file components are **not** parsed by this
  change — see Non-goals.
- **`LanguageId` gains `"python"`** (`packages/core/src/domain/file.ts`). `.py` files are now
  classified with `language: "python"` instead of `"unknown"` (`packages/project-model/src/
  classify.ts`), and Python-specific test-file naming (`test_*.py`, `*_test.py`) is recognized by
  the existing classification priority order.
- **Python parsing uses Tree-sitter** (`tree-sitter` + `tree-sitter-python` npm packages), not the
  TypeScript Compiler API — this is exactly the documented fallback ADR-0006 reserved for "a future
  language with no compiler-API equivalent." A new `parsePythonFile` function
  (`packages/parser/src/python/parse-python-file.ts`) mirrors `parseFile`'s scope from ADR-0006 as
  closely as the language allows: top-level `def`/`class` statements become `FunctionEntity`/
  `ClassEntity`, top-level `import`/`from ... import ...` statements become `ImportBinding`s,
  per-file only (no cross-file resolution — same Module Graph responsibility as JS/TS), same
  deterministic-ID discipline (`(path, kind, name, byte-offset)`), same syntax-error tolerance
  (a Tree-sitter parse never throws; a node with `hasError` becomes a `Diagnostic`).
  `parserProjectIndexer` now dispatches by `file.language`: `javascript`/`typescript` → the existing
  TS-Compiler-API path, `python` → the new Tree-sitter path. Both produce the same `Module`/
  `Symbol`/`FunctionEntity`/`ClassEntity` shapes, so `buildSymbolGraph` (Phase 3) — `DECLARES`/
  `EXTENDS`/`IMPLEMENTS` edges — works over Python output with **zero changes**, the same
  "binding-kind-agnostic" property that made CommonJS support free once ES-module support existed.
  **`buildModuleGraph` does *not*** — verified empirically, not assumed: it produced 0 edges over
  a Python fixture with `import`/`from ... import ...` statements. `module-graph.ts`'s
  `resolveRelativeSpecifier` only understands `./`/`../`-prefixed JS-style relative paths and a
  JS/TS extension list; Python's dotted module specifiers (`"os"`, `".pkg"`, `".pkg.deep"`) and
  file-resolution rules (`.py`, `__init__.py` package roots, `sys.path` lookup for absolute
  imports) are a different resolution algorithm entirely, not a drop-in extension of the JS one.
  Extending `buildModuleGraph` for Python is real, separate follow-up work — see Non-goals.
- **Python import → `ImportKind` mapping** (reusing existing values, no new `ImportKind` added):
  `import x` / `import x as y` → `"namespace"` (Python's `import x` binds the whole module under a
  name, closest to a namespace import); `from x import a` / `from x import a as b` → `"named"`;
  `from x import *` → `"namespace"` with `localName: "*"` (there's no other existing kind that
  fits a wildcard import). Python has no `export` statement — every module-level name is already
  implicitly part of the module's public surface unless it starts with `_` by convention, so
  `Symbol.exported` is set from that naming convention instead of a language keyword, and no
  `ExportBinding`s are emitted (Python has nothing for them to represent).
- **Python package-manager detection**: `requirements.txt` → `pip`, `pyproject.toml` → `poetry`
  (both `PackageManagerKind` values already existed in `packages/core/src/domain/repository.ts`
  from Phase 0 — no core change needed here, just wiring in `packages/project-model/src/
  package-manager.ts`).

## Non-goals

- **Python Module Graph resolution.** `buildModuleGraph` does not resolve Python `import`/
  `from ... import ...` specifiers — confirmed empirically to produce zero `IMPORTS` edges over a
  Python fixture, not just "not yet tested." Python needs its own resolution algorithm (dotted
  module names, `__init__.py` package roots, absolute-import `sys.path` semantics) — a real,
  separate task, not a small addition to the JS-specific resolver.
- **`.vue` single-file component parsing.** A `.vue` file's `<script>` block would need to be
  extracted and fed to the existing TS/JS parser — a real feature, not a one-line addition. Left as
  a documented follow-up; `.vue` files are currently tagged `language: "unknown"`, same as before
  this ADR.
- **Django/Flask/FastAPI framework detection** for Python — would need parsing `requirements.txt`/
  `pyproject.toml` dependency lists the way `frameworks.ts` already parses `package.json`, which is
  a real but separable addition. Not done here; `FrameworkId` has no Python-framework values yet.
- **Any other non-JS/TS language** (C#, PHP, Java, Go, Ruby, Rust, ...) — each needs its own Tree-
  sitter grammar and parser adapter, following the same pattern this ADR establishes for Python, but
  is explicitly out of scope for this decision. Python was chosen as the one language to add now
  (per the user's explicit prioritization), not as a template auto-applied to every language.
- **Python type-checker-derived inference** (type hints beyond their literal text, like TypeScript's
  `typeText` is just the written annotation, not inferred) — same discipline as ADR-0006's `typeText`
  handling for JS/TS: written annotations only, no semantic inference.
- **Python decorators, async functions, nested functions/classes** at anything beyond what Tree-
  sitter's grammar exposes structurally — decorators are captured as raw text (same as the JS/TS
  parser's `decoratorsOf`), async `def` is captured via a flavor/flag, but deeply nested scopes
  follow the same "top-level only" scope Phase 2 established for JS/TS.

## Alternatives considered

- **A generic multi-language Tree-sitter abstraction layer** (one shared "TreeSitterLanguageAdapter"
  interface that Python, and later other languages, all implement) instead of a Python-specific
  module. Rejected for now: with exactly one Tree-sitter-based language, an abstraction layer would
  be speculative (Section 35.7/35.13) — real shared structure will be obvious once a second
  Tree-sitter language actually exists to compare against; premature abstraction here would guess
  wrong about what's actually language-specific vs. shared.
- **Extending `ImportKind`/`ExportKind` with Python-specific values** (e.g. `"wildcard"` for
  `from x import *`). Rejected: reusing `"namespace"` keeps the contract surface small and Python's
  wildcard import is semantically closer to "binds an unknown set of names from this module" than
  to any of the JS-specific kinds; a future language that also needs a wildcard-like kind can reuse
  the same mapping rather than each language inventing its own value.

## Consequences

- `packages/parser/package.json` gains `tree-sitter` and `tree-sitter-python` as runtime
  dependencies — both are native (prebuilt-binary) npm packages; verified they install and run
  cleanly in this environment before committing to this approach.
- `parserProjectIndexer`'s language-dispatch (`javascript`/`typescript` vs. `python`) is the seam
  future languages will extend — adding a third language means adding a third dispatch branch and
  its own parser module, following this ADR's pattern, not a re-architecture.
- `Symbol.exported` for Python is now sometimes derived from a naming convention (leading
  underscore) rather than a language keyword — analyzers reading `Symbol.exported` must not assume
  it always means "has an explicit export statement"; the field's meaning is "considered part of
  this module's public surface," which is keyword-based for JS/TS and convention-based for Python.
