import type { Analyzer, AnalyzerContext, AnalysisResult, Evidence, EvidenceId, Finding, FindingId } from "@code-analyzer/core";

const RULE_ID = "quality/lint-style-rules";

/**
 * Scoped narrowly to facts already sitting on the model (Section 35.13 — not a general linter):
 * three checks, each a single field/count comparison, no new derivation.
 */
const MAX_PARAMETERS = 5; // common convention (ESLint's own max-params default is 3-4; 5 chosen to keep this signal-not-noise given no override config exists yet)
const MAX_FILE_BYTES = 20_000; // ~500 lines of typical TS at ~40 bytes/line; a coarse, honest proxy using data actually on SourceFile (sizeBytes), not a derived LOC guess
const MAX_MODULE_EXPORTS = 15; // barrel/god-module smell: a module re-exporting/declaring this many public symbols is hard to consume safely

export const lintStyleRulesAnalyzer: Analyzer = {
  id: RULE_ID,
  name: "Lint-style structural checks",
  version: "0.1.0",
  capabilities: { category: "quality" },

  supports(context: AnalyzerContext): boolean {
    return context.project.functions.length > 0 || context.project.files.length > 0 || context.project.modules.length > 0;
  },

  async analyze(context: AnalyzerContext): Promise<AnalysisResult> {
    const start = Date.now();
    const findings: Finding[] = [];
    const evidence: Evidence[] = [];
    let index = 0;

    for (const fn of context.project.functions) {
      if (fn.parameters.length <= MAX_PARAMETERS) continue;

      const ev: Evidence = {
        id: `${RULE_ID}-${index}` as EvidenceId,
        kind: "symbol-resolution",
        summary: `${fn.name} declares ${fn.parameters.length} parameters (threshold ${MAX_PARAMETERS})`,
        locations: [fn.location],
        confidence: 0.7,
      };
      evidence.push(ev);
      findings.push({
        id: `${RULE_ID}-${index}` as FindingId,
        ruleId: RULE_ID,
        category: "quality",
        confidence: 0.7,
        severity: "low",
        status: "detected",
        title: `${fn.name} has too many parameters (${fn.parameters.length})`,
        description: `Function "${fn.name}" declares ${fn.parameters.length} parameters, above the ${MAX_PARAMETERS}-parameter threshold. Consider grouping related parameters into an options object.`,
        locations: [fn.location],
        evidenceIds: [ev.id],
        correlatedFindingIds: [],
      });
      index++;
    }

    for (const file of context.project.files) {
      if (file.sizeBytes <= MAX_FILE_BYTES) continue;

      const location = { fileId: file.id, path: file.path };
      const ev: Evidence = {
        id: `${RULE_ID}-${index}` as EvidenceId,
        kind: "symbol-resolution",
        summary: `${file.path} is ${file.sizeBytes} bytes (threshold ${MAX_FILE_BYTES})`,
        locations: [location],
        confidence: 0.6,
      };
      evidence.push(ev);
      findings.push({
        id: `${RULE_ID}-${index}` as FindingId,
        ruleId: RULE_ID,
        category: "quality",
        confidence: 0.6,
        severity: "low",
        status: "detected",
        title: `${file.path} is unusually large (${file.sizeBytes} bytes)`,
        description: `File "${file.path}" is ${file.sizeBytes} bytes, above the ${MAX_FILE_BYTES}-byte threshold. This is a size proxy (bytes, not lines, since the project model doesn't retain line counts for files without functions/classes) and may indicate the file should be split.`,
        locations: [location],
        evidenceIds: [ev.id],
        correlatedFindingIds: [],
      });
      index++;
    }

    for (const module of context.project.modules) {
      if (module.exports.length <= MAX_MODULE_EXPORTS) continue;

      const locations = module.exports.map((e) => e.location);
      const ev: Evidence = {
        id: `${RULE_ID}-${index}` as EvidenceId,
        kind: "symbol-resolution",
        summary: `${module.id} declares ${module.exports.length} exports (threshold ${MAX_MODULE_EXPORTS})`,
        locations,
        confidence: 0.5,
      };
      evidence.push(ev);
      findings.push({
        id: `${RULE_ID}-${index}` as FindingId,
        ruleId: RULE_ID,
        category: "quality",
        confidence: 0.5,
        severity: "low",
        status: "detected",
        title: `${module.id} exports too many symbols (${module.exports.length})`,
        description: `Module "${module.id}" declares ${module.exports.length} exports, above the ${MAX_MODULE_EXPORTS}-export threshold — a common "god module"/barrel smell that makes the module's public surface hard to reason about.`,
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
