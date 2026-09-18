import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { SourceFile } from "@code-analyzer/core";

/** Mirrors `MAX_PARSEABLE_FILE_SIZE_BYTES` in packages/parser/src/project-indexer.ts (Section 31: don't read pathologically large hostile files). */
export const MAX_SCAN_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export type SkipReason = "binary" | "oversized-metadata" | "oversized-disk" | "outside-root" | "unreadable";

export const SKIP_REASON_MESSAGE: Readonly<Record<SkipReason, string>> = {
  binary: "file is classified as binary",
  "oversized-metadata": `file exceeds the ${MAX_SCAN_FILE_SIZE_BYTES}-byte scan size limit (by indexed metadata)`,
  "oversized-disk": `file exceeds the ${MAX_SCAN_FILE_SIZE_BYTES}-byte scan size limit (by on-disk size)`,
  "outside-root": "file's real (symlink-resolved) path resolves outside the scan root",
  unreadable: "file could not be read (missing, permission denied, or a broken symlink)",
};

export type ReadResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: SkipReason };

/**
 * THE sanctioned exception to `Analyzer.analyze()`'s "no file I/O" rule (see
 * packages/core/src/analyzer/analyzer.ts and ADR-0011) — not a pattern to reinvent per analyzer.
 * A second caller must satisfy the same justification test the secrets analyzer did before this
 * was written: raw source text is being matched for something with no AST/graph representation
 * (`SourceFile` in packages/core/src/domain/file.ts only carries metadata, never content), so
 * `context.project` cannot normalize it ahead of time. If what you need CAN be expressed via
 * `context.project`/`context.graphs`, use that instead — this function is not a general-purpose
 * file-reading convenience.
 *
 * Safety mirrors `readSnippet` in packages/cli/src/exporters/html.ts, plus one hardening that
 * cosmetic-display code doesn't need: containment is checked against the *real* (symlink-resolved)
 * path via `realpathSync`, not a string-prefix check on `resolve()`'s output alone — a plain
 * `resolve()` never follows symlinks, so a symlink under `root` pointing outside it (e.g. into a
 * mounted secrets directory) would pass a naive prefix check while `readFileSync` happily follows
 * it and reads the real, out-of-root target. Every failure mode returns a typed `SkipReason`
 * instead of silently swallowing it, so the caller can surface an honest diagnostic (Section 31 /
 * ADR-0004: a skipped file must be visible as "not scanned," never indistinguishable from "scanned,
 * no findings").
 *
 * @param realRoot Must already be `realpathSync`-resolved by the caller (once per scan, not per
 *   file) — computing it here per call would be correct but wastefully repeats the same syscall.
 */
export function readSourceTextSafely(realRoot: string, file: SourceFile): ReadResult {
  if (file.encoding === "binary") return { ok: false, reason: "binary" };
  if (file.sizeBytes > MAX_SCAN_FILE_SIZE_BYTES) return { ok: false, reason: "oversized-metadata" };
  try {
    const realAbs = realpathSync(resolve(file.absolutePath));
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + sep)) return { ok: false, reason: "outside-root" };
    if (statSync(realAbs).size > MAX_SCAN_FILE_SIZE_BYTES) return { ok: false, reason: "oversized-disk" };
    return { ok: true, text: readFileSync(realAbs, "utf-8") };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Resolves and realpath's the scan root once; callers pass the result to every `readSourceTextSafely` call for that scan. Falls back to a non-realpath resolve if the root itself is unreadable, so per-file calls still fail closed via their own `unreadable` path rather than throwing here. */
export function resolveRealRoot(root: string): string {
  try {
    return realpathSync(resolve(root));
  } catch {
    return resolve(root);
  }
}
