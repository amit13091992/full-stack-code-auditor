import { promises as fs } from "node:fs";
import type { ClassEntity, Diagnostic, FunctionEntity, GraphAccess, LanguageId, Logger, Module, ProjectIndexer, ProjectModel, Symbol as SymbolEntity } from "@code-analyzer/core";
import { parseFile } from "./parse-file.js";
import { parsePythonFile } from "./python/parse-python-file.js";

interface ParsedFileResult {
  readonly module: Module;
  readonly symbols: readonly SymbolEntity[];
  readonly functions: readonly FunctionEntity[];
  readonly classes: readonly ClassEntity[];
  readonly diagnostics: readonly Diagnostic[];
}

type LanguageParser = (params: { fileId: Module["fileId"]; path: string; content: string }) => ParsedFileResult;

/**
 * Which parser handles which language (ADR-0006 for JS/TS, ADR-0009 for Python). Adding a new
 * language means adding one entry here and its own parser module — no other branch to touch. This
 * lookup table is the seam future languages extend, not a re-architecture.
 */
const LANGUAGE_PARSERS: Partial<Record<LanguageId, LanguageParser>> = {
  javascript: parseFile,
  typescript: parseFile,
  python: parsePythonFile,
};

const SKIPPED_CLASSIFICATIONS = new Set(["generated", "vendored", "asset"]);

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
 * Per-file `ParseError`s and the size-skip case both surface as real `Diagnostic`s in the
 * returned `diagnostics` array (ADR-0008) so they reach `ScanResult.diagnostics`, not just
 * `logger.debug()` — logging and the diagnostics channel are complementary, not a replacement for
 * each other.
 *
 * `MAX_PARSEABLE_FILE_SIZE_BYTES` below is a security-review-flagged DoS mitigation (Section 31:
 * repository content is hostile input) — files over the threshold are skipped, not parsed. The 5MB
 * value is a conservative stopgap the implementer chose without a tuned benchmark; flagged for
 * human/architect sign-off on the actual threshold, not silently treated as final.
 */
export const parserProjectIndexer: ProjectIndexer = {
  async index(
    project: ProjectModel,
    logger: Logger,
  ): Promise<{ project: ProjectModel; graphs: GraphAccess; diagnostics: readonly Diagnostic[] }> {
    const modules: Module[] = [];
    const symbols: SymbolEntity[] = [];
    const functions: FunctionEntity[] = [];
    const classes: ClassEntity[] = [];
    const diagnostics: Diagnostic[] = [];
    let skippedForSize = 0;

    for (const file of project.files) {
      const parse = LANGUAGE_PARSERS[file.language];
      if (!parse || SKIPPED_CLASSIFICATIONS.has(file.classification)) continue;
      if (file.encoding === "binary") continue;
      if (file.sizeBytes > MAX_PARSEABLE_FILE_SIZE_BYTES) {
        skippedForSize++;
        logger.debug("skipping file over size limit", { path: file.path, sizeBytes: file.sizeBytes, limitBytes: MAX_PARSEABLE_FILE_SIZE_BYTES });
        diagnostics.push({
          code: "FILE_SKIPPED_SIZE_LIMIT",
          severity: "info",
          source: "parser",
          filePath: file.path,
          message: `Skipped ${file.path} (${file.sizeBytes} bytes): exceeds the ${MAX_PARSEABLE_FILE_SIZE_BYTES}-byte parse limit`,
        });
        continue;
      }

      const content = await fs.readFile(file.absolutePath, "utf-8");
      const result = parse({ fileId: file.id, path: file.path, content });

      modules.push(result.module);
      symbols.push(...result.symbols);
      functions.push(...result.functions);
      classes.push(...result.classes);
      diagnostics.push(...result.diagnostics);
      if (result.diagnostics.length > 0) {
        logger.debug("parse diagnostics", { path: file.path, count: result.diagnostics.length });
      }
    }

    logger.debug("parsing complete", { modules: modules.length, symbols: symbols.length, functions: functions.length, classes: classes.length, diagnostics: diagnostics.length, skippedForSize });

    return {
      project: { ...project, modules, symbols, functions, classes },
      graphs: {},
      diagnostics,
    };
  },
};
