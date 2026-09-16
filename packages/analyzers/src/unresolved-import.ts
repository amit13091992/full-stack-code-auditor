import type { Analyzer, AnalyzerContext, AnalysisResult, Evidence, EvidenceId, Finding, FindingId } from "@code-analyzer/core";
import { isRelativeSpecifier, resolveRelativeSpecifier } from "./relative-specifier.js";

const RULE_ID = "architecture/unresolved-import";

/**
 * Flags `ImportBinding`s that use a relative specifier (`./`, `../`) but don't resolve to any
 * project-internal module — almost always a broken import (typo, or the target file was deleted/
 * renamed since the import was written). Bare specifiers (`"react"`, `"express"`) are never flagged:
 * the Module Graph doesn't resolve `node_modules` (Phase 3 non-goal, ADR-0005), so "no edge" for a
 * bare specifier means "external package," not "broken" — getting this distinction wrong is the
 * main false-positive risk for this rule (see fixtures/architecture/unresolved-import).
 */
export const unresolvedImportAnalyzer: Analyzer = {
  id: RULE_ID,
  name: "Unresolved Import",
  version: "0.1.0",
  capabilities: { category: "architecture", requiresGraphs: ["moduleGraph"] },

  supports(context: AnalyzerContext): boolean {
    return Boolean(context.graphs.moduleGraph);
  },

  async analyze(context: AnalyzerContext): Promise<AnalysisResult> {
    const start = Date.now();
    const knownModulePaths = new Set(context.project.modules.map((m) => m.id as string));

    const findings: Finding[] = [];
    const evidence: Evidence[] = [];
    let index = 0;

    for (const module of context.project.modules) {
      for (const binding of module.imports) {
        if (!isRelativeSpecifier(binding.specifier)) continue; // bare specifier -> external package, expected

        const resolved = resolveRelativeSpecifier(module.id as string, binding.specifier, knownModulePaths);
        if (resolved) continue; // resolved to a real project module -> the Module Graph has this edge

        const ev: Evidence = {
          id: `${RULE_ID}-${index}` as EvidenceId,
          kind: "symbol-resolution",
          summary: `"${binding.specifier}" imported from ${module.id} does not resolve to any project module`,
          locations: [binding.location],
          confidence: 1,
        };
        evidence.push(ev);

        findings.push({
          id: `${RULE_ID}-${index}` as FindingId,
          ruleId: RULE_ID,
          category: "architecture",
          // Direct static fact: the specifier is relative, so it must resolve within the project,
          // and it doesn't. Not 1.0 because tsconfig path-mapping/baseUrl aliases aren't modeled by
          // the Module Graph (Phase 3 scope) and could in rare cases make a relative-looking
          // specifier resolve via a bundler/tsconfig rule this analyzer can't see.
          confidence: 0.85,
          // Broken import — a real correctness risk, but a build/lint step usually catches it before
          // this analyzer would see it; not "critical"/"high".
          severity: "medium",
          status: "detected",
          title: `Unresolved import "${binding.specifier}" in ${module.id}`,
          description: `${module.id} imports "${binding.specifier}" using a relative specifier, but no project module resolves to that path. This is likely a broken import (typo, or the target file was renamed/deleted).`,
          locations: [binding.location],
          evidenceIds: [ev.id],
          correlatedFindingIds: [],
        });
        index++;
      }
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
