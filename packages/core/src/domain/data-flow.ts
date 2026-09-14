import type { DataFlowId, FunctionId, SourceLocation, SymbolId } from "./ids.js";

export type TaintSourceKind =
  | "http-request"
  | "query-parameter"
  | "route-parameter"
  | "request-body"
  | "header"
  | "cookie"
  | "file"
  | "environment-variable"
  | "deep-link"
  | "mobile-input"
  | "database-result"
  | "message-queue"
  | "external-api-response";

export type TaintSinkKind =
  | "sql"
  | "shell-command"
  | "filesystem"
  | "html-render"
  | "redirect"
  | "network-request"
  | "eval"
  | "deserialization"
  | "logging"
  | "database-operation";

export interface TaintNode {
  readonly functionId: FunctionId;
  readonly symbolId?: SymbolId;
  readonly location: SourceLocation;
}

export type TaintStepKind = "propagation" | "transformation" | "sanitization";

export interface TaintStep {
  readonly kind: TaintStepKind;
  readonly node: TaintNode;
  /** Name of the sanitizer/transform applied, when known (e.g. "escapeHtml", "parseInt"). */
  readonly operation?: string;
}

/** One reconstructed path from an externally controlled source to a sensitive sink (Section 6). */
export interface DataFlow {
  readonly id: DataFlowId;
  readonly sourceKind: TaintSourceKind;
  readonly source: TaintNode;
  readonly sinkKind: TaintSinkKind;
  readonly sink: TaintNode;
  readonly steps: readonly TaintStep[];
  readonly sanitized: boolean;
  readonly confidence: number;
}
