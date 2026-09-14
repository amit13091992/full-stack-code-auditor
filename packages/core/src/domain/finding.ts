import type { DataFlowId, EvidenceId, FindingId, SourceLocation } from "./ids.js";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** 0 (no confidence) to 1 (certain). Never rounded up to imply more certainty than evidence supports. */
export type Confidence = number;

export type FindingCategory =
  | "security"
  | "architecture"
  | "quality"
  | "performance"
  | "dependency"
  | "secrets"
  | "infrastructure";

/**
 * Verification status distinguishes static suspicion from confirmed fact (Section 19). Analyzers
 * must not report RUNTIME_CONFIRMED unless a DAST/runtime probe (Section 26) actually ran.
 */
export type FindingStatus = "detected" | "likely" | "confirmed" | "runtime_confirmed" | "false_positive";

export interface RiskFactors {
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly exploitability?: number;
  readonly reachability?: number;
  readonly exposure?: number;
  readonly assetCriticality?: number;
}

export interface Remediation {
  readonly summary: string;
  readonly steps: readonly string[];
  readonly references: readonly string[];
}

/** The unit of output for every analysis engine (Section 19). Always attaches Evidence, never asserts confidence without it. */
export interface Finding {
  readonly id: FindingId;
  readonly ruleId: string;
  readonly category: FindingCategory;
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly status: FindingStatus;
  readonly title: string;
  readonly description: string;
  readonly locations: readonly SourceLocation[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly dataFlowId?: DataFlowId;
  readonly remediation?: Remediation;
  readonly cwe?: string;
  readonly owasp?: string;
  readonly risk?: RiskFactors;
  /** Findings from different engines that this finding was merged with by the Correlation Engine (Section 21). */
  readonly correlatedFindingIds: readonly FindingId[];
}
