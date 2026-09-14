import type { Diagnostic } from "../errors/errors.js";
import type { Evidence } from "../domain/evidence.js";
import type { Finding } from "../domain/finding.js";

/** What a single Analyzer returns from `analyze()`, before correlation (Section 21) runs across all of them. */
export interface AnalysisResult {
  readonly analyzerId: string;
  readonly findings: readonly Finding[];
  readonly evidence: readonly Evidence[];
  readonly diagnostics: readonly Diagnostic[];
  readonly durationMs: number;
}
