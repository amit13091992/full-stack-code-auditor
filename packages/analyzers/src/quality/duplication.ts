import type { Analyzer, AnalyzerContext, AnalysisResult, Evidence, EvidenceId, Finding, FindingId, FunctionEntity } from "@code-analyzer/core";

const RULE_ID = "quality/duplication";

/**
 * Design note (per ADR-0010 §2 / the task doc: a documented comparison algorithm, not a full ADR).
 *
 * The textbook approach (normalized-AST or token hashing over N-line windows) needs source text or
 * a retained AST, and `ProjectModel` has neither (checked `packages/core/src/domain/file.ts`,
 * `module.ts`, `function.ts` — no `content` field anywhere, only `contentHash`). Reading files or
 * re-parsing directly from this analyzer would violate the "no direct file I/O / AST parsing"
 * contract, so this rule instead hashes a *structural signature* built only from data Phase 2/3
 * already normalized onto `FunctionEntity`:
 *
 *   signature = flavor | paramCount | paramTypes(joined, "unknown" if untyped) | returnType | LOC bucket (nearest 5)
 *
 * Two functions with an identical signature, declared in two *different* modules, are flagged as
 * candidate structural duplicates. This detects "same-shaped function copy-pasted across files"
 * (a real, common duplication pattern), not "these two functions have identical bodies" — it cannot
 * see body content at all. Confidence is set low (0.3) to reflect that a shared signature is a much
 * weaker signal than shared tokens/AST. This is a real limitation and is stated as such in the
 * Finding text, not hidden, per ADR-0004. A future token/AST-hashing implementation should replace
 * this rule once `ProjectModel` (or a Phase 2 parser extension) retains enough source data to
 * support it, without needing a new core contract for this analyzer itself.
 */
const DUPLICATION_CONFIDENCE = 0.3;
const MIN_LINE_SPAN_TO_CONSIDER = 3; // trivial one-line functions (getters, re-exports) produce noise, not duplication signal

function lineSpanOf(fn: FunctionEntity): number {
  const range = fn.location.range;
  if (!range) return 1;
  return range.end.line - range.start.line + 1;
}

function signatureOf(fn: FunctionEntity): string {
  const paramTypes = fn.parameters.map((p) => p.typeText ?? "unknown").join(",");
  const locBucket = Math.round(lineSpanOf(fn) / 5) * 5;
  return `${fn.flavor}|${fn.parameters.length}|${paramTypes}|${fn.returnTypeText ?? "unknown"}|${locBucket}`;
}

export const duplicationAnalyzer: Analyzer = {
  id: RULE_ID,
  name: "Structural Duplication (signature-based)",
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

    const groups = new Map<string, FunctionEntity[]>();
    for (const fn of context.project.functions) {
      if (lineSpanOf(fn) < MIN_LINE_SPAN_TO_CONSIDER) continue;
      const key = signatureOf(fn);
      const existing = groups.get(key);
      if (existing) existing.push(fn);
      else groups.set(key, [fn]);
    }

    for (const [signature, fns] of groups) {
      const distinctModules = new Set(fns.map((fn) => fn.moduleId as string));
      if (distinctModules.size < 2) continue;

      const locations = fns.map((fn) => fn.location);
      const ev: Evidence = {
        id: `${RULE_ID}-${index}` as EvidenceId,
        kind: "symbol-resolution",
        summary: `${fns.length} function(s) across ${distinctModules.size} module(s) share structural signature "${signature}"`,
        locations,
        confidence: DUPLICATION_CONFIDENCE,
      };
      evidence.push(ev);

      const names = [...new Set(fns.map((fn) => fn.name))].join(", ");
      findings.push({
        id: `${RULE_ID}-${index}` as FindingId,
        ruleId: RULE_ID,
        category: "quality",
        confidence: DUPLICATION_CONFIDENCE,
        severity: "low",
        status: "detected",
        title: `Possible structural duplication across ${distinctModules.size} modules (${names})`,
        description: `${fns.length} function(s) (${names}) across ${distinctModules.size} different modules share the same parameter shape, return type, and approximate line count. This is a structural-signature match, not a body/token comparison (source text isn't retained in the project model) — it may be a coincidental shape match rather than copy-pasted logic. Worth a manual look, not a confirmed duplicate.`,
        locations,
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
