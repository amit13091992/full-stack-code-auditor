/**
 * @code-analyzer/parser — Phase 2 (AST & Semantic Source Model). TypeScript Compiler API,
 * per-file parsing, deterministic IDs (ADR-0006). See docs/tasks/phase-2-ast-semantic-model.md.
 */
export { parseFile } from "./parse-file.js";
export type { ParseFileResult } from "./parse-file.js";
export { parserProjectIndexer } from "./project-indexer.js";
export { toModuleId, toSymbolId, toFunctionId, toClassId } from "./ids.js";
export { toLocation, toRange } from "./location.js";
