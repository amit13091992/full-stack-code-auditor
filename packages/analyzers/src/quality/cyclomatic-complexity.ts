import type { Analyzer, AnalyzerContext, AnalysisResult, Evidence, EvidenceId, Finding, FindingId } from "@code-analyzer/core";
import { computeFunctionMetrics } from "./function-metrics.js";

const RULE_ID = "quality/cyclomatic-complexity";

/**
 * McCabe's original 1976 paper and most static-analysis tools converge on 10 as the threshold past
 * which a function's control flow is hard to reason about/test exhaustively (v(G) > 10). Applied
 * here to the documented proxy score in `function-metrics.ts`, not a real branch count — see that
 * file's doc comment for why. Confidence is capped below the structural analyzers in this package
 * (circular-import/unresolved-import) because the score is a proxy, not a directly-counted fact.
 */
const COMPLEXITY_THRESHOLD = 10;
const PROXY_CONFIDENCE = 0.45;

export const cyclomaticComplexityAnalyzer: Analyzer = {
  id: RULE_ID,
  name: "Cyclomatic Complexity (proxy)",
  version: "0.1.0",
  capabilities: { category: "quality" },

  supports(context: AnalyzerContext): boolean {
    return context.project.functions.length > 0;
  },

  async analyze(context: AnalyzerContext): Promise<AnalysisResult> {
    const start = Date.now();
    const findings: Finding[] = [];
    const evidence: Evidence[] = [];
    let index = 0;

    for (const metrics of computeFunctionMetrics(context.project)) {
      if (metrics.complexityScore <= COMPLEXITY_THRESHOLD) continue;

      const ev: Evidence = {
        id: `${RULE_ID}-${index}` as EvidenceId,
        kind: "symbol-resolution",
        summary: `${metrics.fn.name} spans ${metrics.lineSpan} lines and directly contains ${metrics.nestedFunctionCount} nested function declaration(s); complexity score ${metrics.complexityScore}`,
        locations: [metrics.fn.location],
        confidence: PROXY_CONFIDENCE,
      };
      evidence.push(ev);

      findings.push({
        id: `${RULE_ID}-${index}` as FindingId,
        ruleId: RULE_ID,
        category: "quality",
        confidence: PROXY_CONFIDENCE,
        severity: metrics.complexityScore > COMPLEXITY_THRESHOLD * 2 ? "medium" : "low",
        status: "detected",
        title: `${metrics.fn.name} has high estimated complexity (score ${metrics.complexityScore})`,
        description: `Function "${metrics.fn.name}" has an estimated complexity score of ${metrics.complexityScore} (threshold ${COMPLEXITY_THRESHOLD}), derived from its line span (${metrics.lineSpan}) and directly nested function declarations (${metrics.nestedFunctionCount}). This is a proxy for cyclomatic complexity, not a count of actual branches — the project model does not retain source text or per-branch AST data (Phase 2/3 gap), so this cannot yet count if/for/while/case/&&/||/?: directly. Treat as "worth a closer look", not a precise measurement.`,
        locations: [metrics.fn.location],
        evidenceIds: [ev.id],
        correlatedFindingIds: [],
      });
      index++;
    }

    return {
      analyzerId: RULE_ID,
      findings,
      evidence,
      diagnostics: [],
      durationMs: Date.now() - start,
    };
  },
};
