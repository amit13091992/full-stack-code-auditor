/**
 * @code-analyzer/api — HTTP API exposing the existing `AnalyzerClient`/`ScanEngine` pipeline.
 * Contains no analysis logic of its own — only upload handling, request/response wiring, and
 * streaming, mirroring `@code-analyzer/cli`'s scan wiring against a request-scoped temp workspace.
 */
export { buildServer } from "./server.js";
export type { BuildServerOptions } from "./server.js";
export { runScan } from "./scan/run-scan.js";
export type { RunScanOptions } from "./scan/run-scan.js";
export { DEFAULT_LIMITS } from "./config/limits.js";
export type { ApiLimits } from "./config/limits.js";
export { createTempWorkspace, sweepOrphanedWorkspaces } from "./upload/workspace.js";
export { safeExtractZip, ZipExtractionError } from "./upload/zip-extract.js";
export { intakeMultipartFile, UploadIntakeError } from "./upload/multipart-intake.js";
