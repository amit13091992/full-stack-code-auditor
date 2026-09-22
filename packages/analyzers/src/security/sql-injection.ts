import type {
  Analyzer,
  AnalyzerContext,
  AnalysisResult,
  Diagnostic,
  Evidence,
  EvidenceId,
  Finding,
  FindingId,
  FunctionEntity,
  Graph,
  TaintFlowEdgeData,
} from "@code-analyzer/core";

const RULE_ID = "security/sql-injection";

/**
 * `TaintFlowEdgeData` now lives in `@code-analyzer/core` (alongside `EdgeCertainty`/
 * `TaintSourceKind`/`TaintSinkKind`) precisely because it's built entirely from core types and is
 * read by both `packages/graph` (which produces it) and `packages/analyzers` (which reads it) —
 * both already depend on `core`, so no `analyzers` -> `graph` dependency is needed or added
 * (architecture review: the prior local duplicate here was unnecessary, not a real DAG-safety
 * requirement).
 */

const SCAN_SCOPE_DIAGNOSTIC: Diagnostic = {
  code: "SQL_INJECTION_FIXED_SIGNATURE_SCOPE",
  severity: "info",
  source: RULE_ID,
  message:
    "security/sql-injection recognizes a fixed set of source/sink/sanitizer call shapes " +
    "(see packages/graph/src/taint-signatures.ts); absence of findings does not mean the " +
    "codebase is free of SQL injection, only that no recognized pattern was matched.",
};

/**
 * Certainty-to-confidence mapping for a `FLOWS_TO` edge (ADR-0004: reduced Call Graph edge
 * certainty must reduce reported confidence, never be silently dropped). These numbers are a
 * first-cut judgment call, not derived from any calibration data — deliberately conservative
 * (never 1.0) because even a "direct" edge only proves argument-position reachability through a
 * fixed, small signature table (`taint-signatures.ts`), not a formal data-flow proof.
 */
const CONFIDENCE_BY_CERTAINTY: Record<string, number> = {
  direct: 0.85,
  resolved: 0.75,
  inferred: 0.55,
  dynamic: 0.35,
  unknown: 0.2,
};

/**
 * Sanitization is a named-function-recognition heuristic (`taint-signatures.ts` comment,
 * `docs/tasks/phase-5-taint-graph.md`), not a formal taint-clearing proof — a "sanitized" edge is
 * therefore reported at much lower severity/confidence rather than suppressed outright, so a
 * mis-recognized sanitizer (e.g. `parseInt` called on the wrong variable) doesn't silently hide a
 * real vulnerability (ADR-0004: uncertainty must be representable, never hidden).
 */
const SANITIZED_CONFIDENCE_PENALTY = 0.5;
const SANITIZED_MAX_SEVERITY = "low" as const;

function findFunction(context: AnalyzerContext, entityId: string): FunctionEntity | undefined {
  return context.project.functions.find((fn) => (fn.id as string) === entityId);
}

/**
 * Detects unsanitized (and, at reduced confidence/severity, sanitized) data flow into a SQL sink
 * by reading `FLOWS_TO` edges already reconstructed by the Taint Graph (Phase 5,
 * `packages/graph/src/taint-graph.ts`) — no string/regex matching of source text, per Section 7's
 * requirement to use AST + symbol resolution + call graph + data flow where available.
 */
export const sqlInjectionAnalyzer: Analyzer = {
  id: RULE_ID,
  name: "SQL Injection",
  version: "0.1.0",
  capabilities: { category: "security", requiresGraphs: ["callGraph", "taintGraph"] },

  supports(context: AnalyzerContext): boolean {
    return Boolean(context.graphs.taintGraph);
  },

  async analyze(context: AnalyzerContext): Promise<AnalysisResult> {
    const start = Date.now();
    const findings: Finding[] = [];
    const evidence: Evidence[] = [];

    if (!context.graphs.taintGraph) {
      return { analyzerId: RULE_ID, findings, evidence, diagnostics: [SCAN_SCOPE_DIAGNOSTIC], durationMs: Date.now() - start };
    }
    const taintGraph = context.graphs.taintGraph as Graph<unknown, TaintFlowEdgeData>;

    let findingIndex = 0;
    let evidenceIndex = 0;

    const sqlEdges = taintGraph.query({ edgeType: "FLOWS_TO" }).filter((edge) => edge.data?.sinkKind === "sql");

    for (const edge of sqlEdges) {
      const fromNode = taintGraph.getNode(edge.fromNodeId);
      const toNode = taintGraph.getNode(edge.toNodeId);
      const data = edge.data;
      if (!fromNode || !toNode || !data) continue;

      const sourceFn = findFunction(context, fromNode.entityId);
      const sinkFn = findFunction(context, toNode.entityId);
      if (!sourceFn || !sinkFn) continue; // no honest location -> no finding (never fabricate Evidence)

      const baseConfidence = CONFIDENCE_BY_CERTAINTY[edge.certainty] ?? 0.2;
      const confidence = data.sanitized ? Math.max(0, baseConfidence - SANITIZED_CONFIDENCE_PENALTY) : baseConfidence;
      const severity = data.sanitized ? SANITIZED_MAX_SEVERITY : "critical";

      const sourceEvidence: Evidence = {
        id: `${RULE_ID}-${evidenceIndex++}` as EvidenceId,
        kind: "data-flow-path",
        summary: `Taint source (${data.sourceKind}) via ${data.sourceSignatures.join(", ")} in function "${sourceFn.name}"`,
        locations: [sourceFn.location],
        confidence: baseConfidence,
      };
      const sinkEvidence: Evidence = {
        id: `${RULE_ID}-${evidenceIndex++}` as EvidenceId,
        kind: "data-flow-path",
        summary: `Taint sink (sql) via ${data.sinkSignatures.join(", ")} in function "${sinkFn.name}"${
          data.sanitized ? " (a recognized sanitizer call sits on the path — heuristic recognition, not a proof)" : ""
        }`,
        locations: [sinkFn.location],
        confidence: baseConfidence,
      };
      evidence.push(sourceEvidence, sinkEvidence);

      findings.push({
        id: `${RULE_ID}-${findingIndex++}` as FindingId,
        ruleId: RULE_ID,
        category: "security",
        severity,
        confidence,
        status: "detected",
        title: data.sanitized
          ? `Possible SQL injection (recognized sanitizer on path): "${sourceFn.name}" -> "${sinkFn.name}"`
          : `SQL injection: untrusted ${data.sourceKind} reaches SQL sink in "${sinkFn.name}"`,
        description: data.sanitized
          ? `A tainted value from "${sourceFn.name}" (${data.sourceKind}, via ${data.sourceSignatures.join(", ")}) reaches a SQL sink in "${sinkFn.name}" (via ${data.sinkSignatures.join(", ")}), but a recognized sanitizer call sits on the path. Sanitizer recognition is a named-function heuristic, not a formal proof, so this is reported at reduced severity/confidence rather than suppressed.`
          : `A tainted value from "${sourceFn.name}" (${data.sourceKind}, via ${data.sourceSignatures.join(", ")}) reaches a SQL sink in "${sinkFn.name}" (via ${data.sinkSignatures.join(", ")}) with no recognized sanitizer on the path, via a Call Graph edge of certainty "${edge.certainty}".`,
        locations: [sourceFn.location, sinkFn.location],
        evidenceIds: [sourceEvidence.id, sinkEvidence.id],
        cwe: "CWE-89",
        owasp: "A03:2021",
        correlatedFindingIds: [],
      });
    }

    return {
      analyzerId: RULE_ID,
      findings,
      evidence,
      diagnostics: [SCAN_SCOPE_DIAGNOSTIC],
      durationMs: Date.now() - start,
    };
  },
};
