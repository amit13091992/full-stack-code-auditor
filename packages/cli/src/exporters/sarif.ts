import type { Finding, ResultExporter, ScanResult, Severity, SourceLocation } from "@code-analyzer/core";

const SARIF_SCHEMA = "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";
const SARIF_VERSION = "2.1.0";
const TOOL_NAME = "codegraph-scan";

/** SARIF's `level` is a closed 4-value enum; map our 5-value `Severity` onto it (ADR-0007). */
function toSarifLevel(severity: Severity): "error" | "warning" | "note" | "none" {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "note";
    case "info":
      return "none";
  }
}

/** SARIF regions are 1-based; our `SourcePosition` is explicitly 0-based (ids.ts) — convert, don't copy. */
function toSarifLocation(location: SourceLocation) {
  const region = location.range
    ? {
        startLine: location.range.start.line + 1,
        startColumn: location.range.start.column + 1,
        endLine: location.range.end.line + 1,
        endColumn: location.range.end.column + 1,
      }
    : undefined;
  return {
    physicalLocation: {
      artifactLocation: { uri: location.path },
      ...(region ? { region } : {}),
    },
  };
}

function toSarifResult(finding: Finding) {
  return {
    ruleId: finding.ruleId,
    level: toSarifLevel(finding.severity),
    message: { text: finding.description },
    locations: finding.locations.map(toSarifLocation),
  };
}

/** First finding seen for a ruleId stands in for that rule's identity — `Finding` carries no separate rule catalog today. */
function toSarifRules(findings: readonly Finding[]) {
  const byRuleId = new Map<string, Finding>();
  for (const finding of findings) {
    if (!byRuleId.has(finding.ruleId)) byRuleId.set(finding.ruleId, finding);
  }
  return [...byRuleId.entries()].map(([ruleId, finding]) => ({
    id: ruleId,
    shortDescription: { text: finding.title },
    properties: { category: finding.category },
  }));
}

export const sarifExporter: ResultExporter = {
  format: "sarif",
  export(result: ScanResult): string {
    const sarifLog = {
      $schema: SARIF_SCHEMA,
      version: SARIF_VERSION,
      runs: [
        {
          tool: {
            driver: {
              name: TOOL_NAME,
              rules: toSarifRules(result.findings),
            },
          },
          results: result.findings.map(toSarifResult),
        },
      ],
    };
    return JSON.stringify(sarifLog, null, 2);
  },
};
