# ADR-0011: `Analyzer.analyze()` Raw-Text-Read Exception for Pattern-Scanning Analyzers

## Status

Proposed — pending human sign-off (amit13091992@gmail.com), per `docs/project-status.md`. Flagged
by architecture review of the secrets-detection analyzer (`packages/analyzers/src/secrets/`) as a
real gap: that analyzer exercises a documented purity rule without any ADR recording the exception.

## Context

`Analyzer.analyze()`'s doc comment (`packages/core/src/analyzer/analyzer.ts`) states analyzers
"must not perform ... file I/O ... — both are already normalized into `context.project` before
`analyze()` runs." This is true and enforceable for every graph/AST-based analyzer
(`architecture/circular-import`, `architecture/unresolved-import`, `quality/unused-export`) — their
inputs are fully captured in `context.project`/`context.graphs` before `analyze()` is called, so
they are pure functions of `context`.

Secrets detection (`secrets/pattern-scan`, first analyzer in the `secrets` category) breaks that
purity by necessity, not oversight: it regex-matches raw source text for credential shapes (AWS
keys, GitHub tokens, PEM headers, etc.), and `SourceFile` (`packages/core/src/domain/file.ts`)
carries only metadata (path, size, content hash, encoding) — never text content. There is no
AST/graph representation of "this string literal has the shape of an AWS key" to normalize ahead of
time; this is true industry-wide (gitleaks, trufflehog work the same way). The implementation
(`packages/analyzers/src/secrets/secrets-analyzer.ts`) added a local `readSourceTextSafely()`
helper that calls `readFileSync`/`statSync`/`realpathSync` directly inside `analyze()`, guarded by:
a path-containment check against `config.root` using the *real* (symlink-resolved) path, a size cap
matching `packages/parser/src/project-indexer.ts`'s `MAX_PARSEABLE_FILE_SIZE_BYTES`, a binary-file
skip, and catch-and-skip instead of throwing past the `Analyzer.analyze()` boundary (Section 31:
repository content is hostile input).

This makes `secretsAnalyzer` a function of `context` *plus live disk state at scan time* — a
meaningfully different contract than the other three analyzers (re-running it against the same
`context` object can produce a different result if the file changed or vanished on disk in
between). Architecture review's finding: keeping the read local to one file avoids widening
`AnalyzerContext`'s surface for every *other* analyzer, but it does not preserve purity for *this*
analyzer, and nothing currently stops a second raw-text analyzer (a license-header checker, a
TODO/FIXME scanner) from reinventing its own slightly-different, possibly-buggier version of the
same traversal/size-cap logic.

## Decision

1. **The "no file I/O" rule in `Analyzer.analyze()`'s doc comment gets one narrow, named
   exception**: a pattern-scanning analyzer whose detection is inherently over raw source text (no
   AST/graph representation exists or ever will for what it's matching) may read file content
   directly, subject to every one of these constraints:
   - The read logic lives in a **shared, explicitly-labeled utility** —
     `packages/analyzers/src/shared/read-source-text-safely.ts` — not reimplemented per analyzer.
     `secrets-analyzer.ts`'s current local copy moves there as the first (and, until a second real
     caller exists, only) consumer.
   - The utility's doc comment states it is *the* sanctioned exception, lists the constraints below,
     and says a second caller must satisfy the same justification test this ADR applies to secrets
     detection (no AST/graph alternative exists) — not "raw text happened to be convenient."
   - Containment is checked against the realpath-resolved root (not a string-prefix check on
     `resolve()`'s output alone — a plain `resolve()` never follows symlinks, so a symlink under
     `root` pointing outside it would pass a naive check while the actual read follows it out).
   - A hard size cap is enforced from file metadata *and* re-checked against live `stat()` size
     before the read (metadata can't be trusted alone — Section 31).
   - Binary-encoded files are skipped.
   - Every skip (oversized, binary, outside-root, unreadable) is surfaced as a `Diagnostic` on the
     `AnalysisResult`, aggregated by reason — never silently dropped. A clean scan result must never
     be indistinguishable from "some files were never actually scanned" (ADR-0004).
   - The analyzer never throws past this boundary — a missing/huge/binary/outside-root file is a
     skip, not a crashed scan.
2. **`AnalyzerContext` gains no general `readFile` method.** Every analyzer that doesn't need raw
   text (the large majority — anything graph/AST-based) stays a pure function of `context`, exactly
   as `analyzer.ts`'s doc comment says. The exception is opt-in per analyzer, not a capability handed
   to all of them.
3. **`analyzer.ts`'s doc comment is updated** to reference this ADR by name at the point it states
   the "no file I/O" rule, so a future reader of that file discovers the exception exists instead of
   having to find it via an unrelated analyzer's source.

## Alternatives Considered

- **Promote raw-text access into `AnalyzerContext` (e.g. `context.readFile(fileId)`).** Rejected:
  this would be a real core contract change requiring a broader ADR under Section 46, and would
  invite every analyzer to reach for raw text instead of the graph/AST model that exists specifically
  so analyzers don't each re-parse source independently. The whole point of `context.project` is
  that expensive normalization happens once; a general read escape hatch undermines that for
  analyzers that don't strictly need it.
- **Store raw text on `SourceFile` so it's already "normalized."** Rejected: memory cost across a
  large repository (holding every file's full text in `ProjectModel` simultaneously) for a capability
  only one analyzer category needs; `contentHash` already exists for incremental-analysis purposes
  without paying that cost.
- **Leave the read logic local to `secrets-analyzer.ts` with only a comment warning future authors
  not to copy it.** Rejected per architecture review: a comment is not enforcement, and a second
  raw-text analyzer (quality/security rules are actively being scoped per ADR-0010) reinventing this
  logic with a subtly different traversal-guard bug is a near-term risk, not hypothetical.

## Consequences

- No change to `Analyzer`, `AnalyzerContext`, `SourceFile`, or any other Section 37C frozen contract
  — this ADR documents an implementation-level exception and relocates shared logic, it does not
  change any exported interface.
- `packages/analyzers/src/shared/` becomes the one place a second raw-text-reading analyzer looks
  first, instead of writing its own.
- A future analyzer wanting raw-text access must satisfy this ADR's justification test before adding
  a second caller to the shared utility — reviewed the same way `secrets-analyzer.ts` was, per the
  enhanced review path in `docs/security/overview.md` if the analyzer also touches secrets/taint/auth.
- This ADR does not relax or touch the Phase 4/5 gates ADR-0010 restates for graph-dependent
  security/quality analyzers — it is scoped only to the file-I/O exception itself.
