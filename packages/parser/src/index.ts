/**
 * @code-analyzer/parser — AST & Semantic Source Model. TypeScript Compiler API for JS/TS
 * (ADR-0006), Tree-sitter for Python (ADR-0009). Per-file parsing, deterministic IDs.
 */
export { parseFile } from "./parse-file.js";
export type { ParseFileResult } from "./parse-file.js";
export { parsePythonFile } from "./python/parse-python-file.js";
export type { ParsePythonFileResult } from "./python/parse-python-file.js";
export { parserProjectIndexer } from "./project-indexer.js";
export { toModuleId, toSymbolId, toFunctionId, toClassId } from "./ids.js";
export { toLocation, toRange } from "./location.js";
