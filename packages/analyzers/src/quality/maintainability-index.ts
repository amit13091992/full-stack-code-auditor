import type { Analyzer, AnalyzerContext, AnalysisResult, Evidence, EvidenceId, Finding, FindingId } from "@code-analyzer/core";
import { computeFunctionMetrics } from "./function-metrics.js";

const RULE_ID = "quality/maintainability-index";

/**
 * The standard Maintainability Index (Coleman/Oman, popularized by Visual Studio's code metrics)
 * is `171 - 5.2*ln(HalsteadVolume) - 0.23*CyclomaticComplexity - 16.2*ln(LinesOfCode)`. Halstead
 * Volume needs operator/operand counts from source text, which `ProjectModel` doesn't retain (see
 * `function-metrics.ts`'s doc comment) — so this uses the documented simplified variant that drops
 * the Halstead term, the same substitution Visual Studio itself historically shipped when a
 * Halstead pass wasn't available: `MI' = 171 - 0.23*CC - 16.2*ln(LOC)`, then rescaled to 0-100 the
 * same way (`max(0, MI * 100 / 171)`) so the conventional "below 65 needs attention" band still
 * applies. `CC` here is this package's documented complexity-score proxy, not a true branch count.
 */
const MI_ATTENTION_THRESHOLD = 65;
const CONFIDENCE = 0.4; // composite of two proxies (complexity score, LOC) -> lower than either alone

function maintainabilityIndex(complexityScore: number, lineSpan: number): number {
  const loc = Math.max(lineSpan, 1);
  const raw = 171 - 0.23 * complexityScore - 16.2 * Math.log(loc);
  const rescaled = Math.max(0, (raw * 100) / 171);
  return Math.round(rescaled * 10) / 10;
}

export const maintainabilityIndexAnalyzer: Analyzer = {
  id: RULE_ID,
  name: "Maintainability Index (simplified, no Halstead)",
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
      const mi = maintainabilityIndex(metrics.complexityScore, metrics.lineSpan);
      if (mi >= MI_ATTENTION_THRESHOLD) continue;

      const ev: Evidence = {
        id: `${RULE_ID}-${index}` as EvidenceId,
        kind: "symbol-resolution",
        summary: `${metrics.fn.name}: simplified MI ${mi} (complexity score ${metrics.complexityScore}, ${metrics.lineSpan} lines)`,
        locations: [metrics.fn.location],
        confidence: CONFIDENCE,
      };
      evidence.push(ev);

      findings.push({
        id: `${RULE_ID}-${index}` as FindingId,
        ruleId: RULE_ID,
        category: "quality",
        confidence: CONFIDENCE,
        severity: mi < MI_ATTENTION_THRESHOLD / 2 ? "medium" : "low",
        status: "detected",
        title: `${metrics.fn.name} has low estimated maintainability (MI ${mi})`,
        description: `Function "${metrics.fn.name}" scores ${mi}/100 on a simplified Maintainability Index (below the conventional ${MI_ATTENTION_THRESHOLD} "needs attention" threshold), computed from its line span and this package's complexity-score proxy. This variant omits the Halstead Volume term the standard MI formula uses, because source text/token data isn't retained in the project model — treat this as directional, not a precise measurement.`,
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
