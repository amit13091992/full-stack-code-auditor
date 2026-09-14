import { promises as fs } from "node:fs";
import type { ClassEntity, Diagnostic, FunctionEntity, GraphAccess, LanguageId, Logger, Module, ProjectIndexer, ProjectModel, Symbol as SymbolEntity } from "@code-analyzer/core";
import { parseFile } from "./parse-file.js";
import { parsePythonFile } from "./python/parse-python-file.js";

/**
 * Which parser handles which language (ADR-0006 for JS/TS, ADR-0009 for Python). Adding a new
 * language means adding a branch here and its own parser module — this dispatch is the seam future
 * languages extend, not a re-architecture.
 */
const PARSEABLE_LANGUAGES = new Set<LanguageId>(["javascript", "typescript", "python"]);
const SKIPPED_CLASSIFICATIONS = new Set(["generated", "vendored", "asset"]);

interface ParsedFileResult {
  readonly module: Module;
  readonly symbols: readonly SymbolEntity[];
  readonly functions: readonly FunctionEntity[];
  readonly classes: readonly ClassEntity[];
  readonly diagnostics: readonly Diagnostic[];
}

function parseByLanguage(language: LanguageId, params: { fileId: Module["fileId"]; path: string; content: string }): ParsedFileResult | undefined {
  if (language === "javascript" || language === "typescript") return parseFile(params);
  if (language === "python") return parsePythonFile(params);
  return undefined;
}

/**
 * Files larger than this are skipped rather than parsed (Section 31: repository content is
 * hostile input). 5 MB is generous for hand-written source — genuinely huge single-file JS/TS is
 * itself a strong signal of generated/vendored/minified content that Phase 1 classification may
 * have missed, not a file worth spending unbounded parse time/memory on. This is a conservative
 * stopgap, not a tuned value; revisit with real large-repository profiling data (Section 43) if it
 * turns out to be too aggressive or not aggressive enough.
 */
const MAX_PARSEABLE_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * The `ProjectIndexer` for source parsing (docs/tasks/phase-2-ast-semantic-model.md,
 * ADR-0009): parses every eligible file from Phase 1 discovery — JavaScript/TypeScript via the
 * TypeScript Compiler API, Python via Tree-sitter — and populates `modules`/`symbols`/
 * `functions`/`classes` on the `ProjectModel`. `graphs` stays `{}` — module/symbol/call/taint
 * graphs are Phase 3-5, not this.
 *
 * Known contract gap (flagged for architect review, not fixed here): `ProjectIndexer.index()`
 * (packages/core/src/analyzer/pipeline.ts) has no return channel for `Diagnostic`s, so per-file
 * `ParseError`s surfaced by `parseFile` — and the "skipped, file too large" case below — are only
 * logged (`logger.debug`) — they never reach the final `ScanResult.diagnostics`. This doesn't
 * violate Section 2's syntax-error tolerance (a bad file still doesn't abort the run), but it does
 * mean a user has no way to see *which* files failed to parse or were skipped from the CLI's report
 * output. Fixing this needs a core-contract change (add `diagnostics` to `ProjectIndexer.index()`'s
 * return type) and an ADR, per CLAUDE.md's "any change to a Section 37C contract needs an ADR"
 * rule — not something to patch around in this package. Architect review (see docs/project-status.md)
 * recommends this land as ADR-0008 + a small fix at the start of Phase 3 work, before more
 * `ProjectIndexer`-adjacent consumers exist.
 *
 * `MAX_PARSEABLE_FILE_SIZE_BYTES` below is a security-review-flagged DoS mitigation (Section 31:
 * repository content is hostile input) — files over the threshold are skipped, not parsed. The 5MB
 * value is a conservative stopgap the implementer chose without a tuned benchmark; flagged for
 * human/architect sign-off on the actual threshold, not silently treated as final.
 */
export const parserProjectIndexer: ProjectIndexer = {
  async index(project: ProjectModel, logger: Logger): Promise<{ project: ProjectModel; graphs: GraphAccess }> {
    const modules: Module[] = [];
    const symbols: SymbolEntity[] = [];
    const functions: FunctionEntity[] = [];
    const classes: ClassEntity[] = [];
    const diagnosticCount = { total: 0 };
    let skippedForSize = 0;

    for (const file of project.files) {
      if (!PARSEABLE_LANGUAGES.has(file.language) || SKIPPED_CLASSIFICATIONS.has(file.classification)) continue;
      if (file.encoding === "binary") continue;
      if (file.sizeBytes > MAX_PARSEABLE_FILE_SIZE_BYTES) {
        skippedForSize++;
        logger.debug("skipping file over size limit", { path: file.path, sizeBytes: file.sizeBytes, limitBytes: MAX_PARSEABLE_FILE_SIZE_BYTES });
        continue;
      }

      const content = await fs.readFile(file.absolutePath, "utf-8");
      const result = parseByLanguage(file.language, { fileId: file.id, path: file.path, content });
      if (!result) continue;

      modules.push(result.module);
      symbols.push(...result.symbols);
      functions.push(...result.functions);
      classes.push(...result.classes);
      diagnosticCount.total += result.diagnostics.length;
      if (result.diagnostics.length > 0) {
        logger.debug("parse diagnostics", { path: file.path, count: result.diagnostics.length });
      }
    }

    logger.debug("parsing complete", { modules: modules.length, symbols: symbols.length, functions: functions.length, classes: classes.length, diagnostics: diagnosticCount.total, skippedForSize });

    return {
      project: { ...project, modules, symbols, functions, classes },
      graphs: {},
    };
  },
};
