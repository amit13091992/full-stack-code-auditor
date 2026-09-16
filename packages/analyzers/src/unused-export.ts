import type { Analyzer, AnalyzerContext, AnalysisResult, Evidence, EvidenceId, Finding, FindingId, SourceLocation } from "@code-analyzer/core";
import { moduleNodeId } from "./module-node-ids.js";

const RULE_ID = "quality/unused-export";

const ENTRY_POINT_PATTERN = /(^|\/)index\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;

/**
 * `ProjectModel`/`Repository`/`WorkspacePackage` don't capture a `package.json` `"main"`/`"module"`
 * field anywhere today (checked packages/core/src/domain/project.ts, repository.ts before writing
 * this) — so entry-point exclusion here is `index.*`-only, per the task doc's documented fallback.
 * Known limitation: a package whose real entry point is a non-`index` file named in `package.json`
 * `"main"` (e.g. `"main": "lib/cli.ts"`) will be flagged as unused even though it's an entry point.
 */
function isLikelyEntryPoint(modulePath: string): boolean {
  return ENTRY_POINT_PATTERN.test(modulePath);
}

/**
 * `Module.exports` (`ExportBinding[]`) only covers explicit `export { x }`/`export default`/
 * re-export statements — an inline `export function foo() {}` or `export class Bar {}` declaration
 * doesn't produce an `ExportBinding` (confirmed empirically against the parser, not assumed). The
 * task doc's actual signal is "`Symbol`/`FunctionEntity`/`ClassEntity` with `exported`/`isExported`
 * true," so this reads those three collections directly instead of `Module.exports`.
 */
function exportedLocationsByModule(project: AnalyzerContext["project"]): Map<string, SourceLocation[]> {
  const byModule = new Map<string, SourceLocation[]>();
  const add = (moduleId: string, location: SourceLocation) => {
    const existing = byModule.get(moduleId);
    if (existing) existing.push(location);
    else byModule.set(moduleId, [location]);
  };

  for (const symbol of project.symbols) {
    if (symbol.exported) add(symbol.moduleId as string, symbol.declarationLocation);
  }
  for (const fn of project.functions) {
    if (fn.isExported) add(fn.moduleId as string, fn.location);
  }
  for (const cls of project.classes) {
    if (cls.isExported) add(cls.moduleId as string, cls.location);
  }
  return byModule;
}

/**
 * Flags a module whose exports look plausibly unused: it has at least one exported `Symbol`/
 * `FunctionEntity`/`ClassEntity`, isn't a likely entry point, and has zero incoming `IMPORTS` edges
 * anywhere in the project. This is necessarily heuristic (see docs/tasks/first-graph-analyzers.md):
 * it can only say "no other module in this project imports this module at all" — never "this
 * specific export is unused," since the Module Graph resolves module-to-module edges, not which
 * named export was actually consumed (that needs `REFERENCES` edges, Phase 4+). Confidence is set
 * noticeably lower than the other two rules in this package for exactly that reason.
 */
export const unusedExportAnalyzer: Analyzer = {
  id: RULE_ID,
  name: "Unused Export (module-level)",
  version: "0.1.0",
  capabilities: { category: "quality", requiresGraphs: ["moduleGraph"] },

  supports(context: AnalyzerContext): boolean {
    return Boolean(context.graphs.moduleGraph);
  },

  async analyze(context: AnalyzerContext): Promise<AnalysisResult> {
    const start = Date.now();
    const graph = context.graphs.moduleGraph!;
    const exportedLocations = exportedLocationsByModule(context.project);

    const findings: Finding[] = [];
    const evidence: Evidence[] = [];
    let index = 0;

    for (const module of context.project.modules) {
      const locations = exportedLocations.get(module.id as string);
      if (!locations || locations.length === 0) continue;
      if (isLikelyEntryPoint(module.id as string)) continue;

      const incoming = graph.query({ edgeType: "IMPORTS", toNodeId: moduleNodeId(module.id as string) });
      if (incoming.length > 0) continue;

      const ev: Evidence = {
        id: `${RULE_ID}-${index}` as EvidenceId,
        kind: "symbol-resolution",
        summary: `${module.id} has ${locations.length} exported declaration(s) and zero incoming IMPORTS edges in the project's Module Graph`,
        locations,
        // Same static fact the finding reports, not a separate cross-check -> mirror the finding's confidence.
        confidence: 0.35,
      };
      evidence.push(ev);

      findings.push({
        id: `${RULE_ID}-${index}` as FindingId,
        ruleId: RULE_ID,
        category: "quality",
        // Weakest signal of the three analyzers in this package: module-level only (can't say which
        // export), no visibility into dynamic import(), non-relative/aliased imports the Module
        // Graph doesn't resolve, re-exports via a barrel this project doesn't parse as an entry
        // point, or consumption from outside this repository (published package). 0.35 reflects
        // "worth a human look" without claiming anything close to certainty.
        confidence: 0.35,
        severity: "low",
        status: "detected",
        title: `No other module in this project imports "${module.id}"`,
        description: `No other module in this project imports ${module.id}, which has ${locations.length} exported declaration(s). This does not mean the exports are unused — only that no project-internal module currently imports this module directly (external consumers, dynamic imports, and unresolved/aliased import forms aren't visible to this check).`,
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
