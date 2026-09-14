/** Error/diagnostic model (Section 37F). Every failure mode the platform can hit is typed. */

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source: string;
  readonly filePath?: string;
  readonly cause?: unknown;
}

export class AnalyzerError extends Error {
  readonly code: string;
  readonly source: string;
  override readonly cause?: unknown;

  constructor(code: string, message: string, source: string, cause?: unknown) {
    super(message);
    this.name = "AnalyzerError";
    this.code = code;
    this.source = source;
    this.cause = cause;
  }
}

export class ParseError extends AnalyzerError {
  readonly filePath: string;

  constructor(message: string, filePath: string, cause?: unknown) {
    super("PARSE_ERROR", message, "parser", cause);
    this.name = "ParseError";
    this.filePath = filePath;
  }
}

export class PluginError extends AnalyzerError {
  readonly pluginId: string;

  constructor(message: string, pluginId: string, cause?: unknown) {
    super("PLUGIN_ERROR", message, "plugin", cause);
    this.name = "PluginError";
    this.pluginId = pluginId;
  }
}

export class ConfigurationError extends AnalyzerError {
  constructor(message: string, cause?: unknown) {
    super("CONFIGURATION_ERROR", message, "config", cause);
    this.name = "ConfigurationError";
  }
}

export class ScanCancelledError extends AnalyzerError {
  constructor(message = "Scan was cancelled") {
    super("SCAN_CANCELLED", message, "scan-lifecycle");
    this.name = "ScanCancelledError";
  }
}

export class SandboxViolationError extends AnalyzerError {
  constructor(message: string, cause?: unknown) {
    super("SANDBOX_VIOLATION", message, "sandbox", cause);
    this.name = "SandboxViolationError";
  }
}
