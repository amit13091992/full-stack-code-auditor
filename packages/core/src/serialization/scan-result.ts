import type { Diagnostic } from "../errors/errors.js";
import type { Evidence } from "../domain/evidence.js";
import type { Finding } from "../domain/finding.js";
import type { Scan } from "../domain/scan.js";

export const SCAN_RESULT_SCHEMA_VERSION = "0.1.0";

/**
 * The stable, serializable output of `analyzer.scan()` (Section 37H). This is the one format the
 * CLI, CI/CD integrations, dashboards, and IDE extensions all consume — none of them may invent
 * their own result shape. `schemaVersion` must be bumped on any breaking field change.
 */
export interface ScanResult {
  readonly schemaVersion: string;
  readonly scan: Scan;
  readonly findings: readonly Finding[];
  readonly evidence: readonly Evidence[];
  readonly diagnostics: readonly Diagnostic[];
  readonly summary: ScanSummary;
}

export interface ScanSummary {
  readonly totalFindings: number;
  readonly findingsBySeverity: Readonly<Record<string, number>>;
  readonly findingsByCategory: Readonly<Record<string, number>>;
  readonly filesAnalyzed: number;
  readonly analyzersRun: readonly string[];
}

/** Converters to/from other well-known formats live behind this contract, not inline in core. */
export interface ResultExporter {
  readonly format: "json" | "sarif" | "html";
  export(result: ScanResult): string;
}
