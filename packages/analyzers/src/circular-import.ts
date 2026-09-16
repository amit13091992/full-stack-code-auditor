import type {
  Analyzer,
  AnalyzerContext,
  AnalysisResult,
  Evidence,
  EvidenceId,
  Finding,
  FindingId,
  Graph,
} from "@code-analyzer/core";
import { moduleNodeId } from "./module-node-ids.js";
import { resolveRelativeSpecifier } from "./relative-specifier.js";

const RULE_ID = "architecture/circular-import";

/**
 * Finds the originating `ImportBinding` (and its `SourceLocation`) for a resolved
 * `fromModuleId -> toModuleId` edge, so the finding points at the actual `import` statement instead
 * of just naming the two modules. Falls back to the module's own declaration if, for some reason, no
 * binding matches (should not happen for an edge the Module Graph itself produced, but Evidence must
 * never be fabricated — see ADR-0004).
 */
function findImportLocation(context: AnalyzerContext, fromModuleId: string, toModuleId: string, knownModulePaths: ReadonlySet<string>) {
  const fromModule = context.project.modules.find((m) => m.id === fromModuleId);
  if (!fromModule) return undefined;
  for (const binding of fromModule.imports) {
    const resolved = resolveRelativeSpecifier(fromModuleId, binding.specifier, knownModulePaths);
    if (resolved === toModuleId) return binding.location;
  }
  return undefined;
}

/**
 * Detects import cycles in the Module Graph: a module that transitively imports itself through
 * `IMPORTS` edges only (Phase 3 Module Graph — resolved project-internal imports, not `node_modules`).
 * Each distinct cycle (deduped by the sorted set of participating module IDs) is reported once, not
 * once per participating module.
 */
export const circularImportAnalyzer: Analyzer = {
  id: RULE_ID,
  name: "Circular Import",
  version: "0.1.0",
  capabilities: { category: "architecture", requiresGraphs: ["moduleGraph"] },

  supports(context: AnalyzerContext): boolean {
    return Boolean(context.graphs.moduleGraph);
  },

  async analyze(context: AnalyzerContext): Promise<AnalysisResult> {
    const start = Date.now();
    const graph = context.graphs.moduleGraph as Graph;
    const knownModulePaths = new Set(context.project.modules.map((m) => m.id as string));

    const findings: Finding[] = [];
    const evidence: Evidence[] = [];
    const seenCycles = new Set<string>();
    let findingIndex = 0;
    let evidenceIndex = 0;

    for (const module of context.project.modules) {
      const fromId = module.id as string;
      const outgoing = graph.query({ edgeType: "IMPORTS", fromNodeId: moduleNodeId(fromId) });

      for (const edge of outgoing) {
        const toNode = graph.getNode(edge.toNodeId);
        if (!toNode) continue;
        const toId = toNode.entityId;

        // Direct self-import: A imports A. No need for findPaths — the cycle is the edge itself.
        let cycleModuleIds: string[] | undefined;
        if (toId === fromId) {
          cycleModuleIds = [fromId];
        } else {
          const backPaths = graph.findPaths(edge.toNodeId, moduleNodeId(fromId));
          const shortest = backPaths[0];
          if (shortest) {
            cycleModuleIds = [fromId, ...shortest.nodes.map((n) => n.entityId)];
          }
        }
        if (!cycleModuleIds) continue;

        const dedupeKey = [...new Set(cycleModuleIds)].sort().join("|");
        if (seenCycles.has(dedupeKey)) continue;
        seenCycles.add(dedupeKey);

        const cycleEvidence: Evidence[] = [];
        const orderedCycle = [...new Set(cycleModuleIds)];
        for (let i = 0; i < orderedCycle.length; i++) {
          const from = orderedCycle[i]!;
          const to = orderedCycle[(i + 1) % orderedCycle.length]!;
          const location = findImportLocation(context, from, to, knownModulePaths);
          if (!location) continue;
          const ev: Evidence = {
            id: `${RULE_ID}-${evidenceIndex++}` as EvidenceId,
            kind: "symbol-resolution",
            summary: `${from} imports ${to}`,
            locations: [location],
            confidence: 1,
          };
          cycleEvidence.push(ev);
        }
        if (cycleEvidence.length === 0) continue; // no honest location -> no finding (never fabricate Evidence)
        evidence.push(...cycleEvidence);

        const cycleDescription = [...orderedCycle, orderedCycle[0]].join(" -> ");
        findings.push({
          id: `${RULE_ID}-${findingIndex++}` as FindingId,
          ruleId: RULE_ID,
          category: "architecture",
          // Deterministic structural fact over resolved IMPORTS edges, not a heuristic match — high
          // confidence, but not 1.0 since re-export flattening / barrel files can make the true
          // runtime cycle slightly different from the file-level one the Module Graph models.
          confidence: 0.9,
          // Maintainability/architecture smell (can cause init-order bugs), not a security issue.
          severity: "medium",
          status: "detected",
          title: `Circular import: ${cycleDescription}`,
          description: `These modules import each other transitively, forming a cycle: ${cycleDescription}. This can cause module-initialization-order bugs and makes the modules hard to reason about independently.`,
          locations: cycleEvidence.flatMap((e) => e.locations),
          evidenceIds: cycleEvidence.map((e) => e.id),
          correlatedFindingIds: [],
        });
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
