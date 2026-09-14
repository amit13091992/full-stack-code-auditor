/**
 * @code-analyzer/cli — Section 32 CLI, and the JSON/SARIF/HTML report exporters (ADR-0007).
 * Contains no analysis logic — only argument parsing, output formatting, and wiring to
 * `AnalyzerClient`. See docs/tasks/cli-and-reporting.md.
 */
export { getExporter, jsonExporter, sarifExporter, htmlExporter } from "./exporters/index.js";
export type { ExportFormat } from "./exporters/index.js";
export { InMemoryAnalyzerRegistry } from "./registry.js";
export { parseArgs, CliArgumentError } from "./args.js";
export type { ParsedArgs } from "./args.js";
export { runScanCommand } from "./commands/scan.js";
export type { ScanCommandResult } from "./commands/scan.js";
export { runExportCommand } from "./commands/export.js";
export type { ExportCommandResult } from "./commands/export.js";
