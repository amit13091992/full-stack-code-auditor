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
              rules: [...new Set(result.findings.map((f) => f.ruleId))].map((ruleId) => ({ id: ruleId })),
            },
          },
          results: result.findings.map(toSarifResult),
        },
      ],
    };
    return JSON.stringify(sarifLog, null, 2);
  },
};
