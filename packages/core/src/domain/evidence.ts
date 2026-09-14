import type { DataFlowId, EvidenceId, SourceLocation } from "./ids.js";

export type EvidenceKind =
  | "ast-pattern"
  | "symbol-resolution"
  | "call-graph-path"
  | "data-flow-path"
  | "dependency-metadata"
  | "config-value"
  | "runtime-observation"
  | "external-tool";

/**
 * Machine-readable justification for a Finding, kept separate from the finding's human-readable
 * description (Section 20). Every field here must be traceable back to source — no evidence
 * entry may assert something that cannot be pointed at in the repository or a named external tool.
 */
export interface Evidence {
  readonly id: EvidenceId;
  readonly kind: EvidenceKind;
  readonly summary: string;
  readonly locations: readonly SourceLocation[];
  readonly dataFlowId?: DataFlowId;
  readonly sourceTool?: string;
  readonly confidence: number;
}
