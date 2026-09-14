import type { Finding, ResultExporter, ScanResult, Severity } from "@code-analyzer/core";

const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFinding(finding: Finding): string {
  const locations = finding.locations
    .map((loc) => escapeHtml(loc.range ? `${loc.path}:${loc.range.start.line + 1}` : loc.path))
    .join(", ");
  return `
    <li class="finding severity-${finding.severity}">
      <div class="finding-title">${escapeHtml(finding.title)}</div>
      <div class="finding-meta">${escapeHtml(finding.ruleId)} &middot; confidence ${finding.confidence.toFixed(2)} &middot; ${escapeHtml(finding.status)}</div>
      <div class="finding-description">${escapeHtml(finding.description)}</div>
      ${locations ? `<div class="finding-locations">${escapeHtml(locations)}</div>` : ""}
    </li>`;
}

/** A single self-contained static report — no client-side JS, no external assets (ADR-0007/Section 32). */
export const htmlExporter: ResultExporter = {
  format: "html",
  export(result: ScanResult): string {
    const bySeverity = new Map<Severity, Finding[]>();
    for (const finding of result.findings) {
      const bucket = bySeverity.get(finding.severity) ?? [];
      bucket.push(finding);
      bySeverity.set(finding.severity, bucket);
    }

    const sections = SEVERITY_ORDER.filter((severity) => bySeverity.has(severity))
      .map((severity) => {
        const findings = bySeverity.get(severity) ?? [];
        return `
      <section>
        <h2>${escapeHtml(severity)} (${findings.length})</h2>
        <ul>${findings.map(renderFinding).join("")}</ul>
      </section>`;
      })
      .join("");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>code-analyzer report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { margin-bottom: 0.25rem; }
  .summary { color: #555; margin-bottom: 1.5rem; }
  .finding { border-left: 4px solid #999; padding: 0.5rem 0.75rem; margin-bottom: 0.75rem; background: #fafafa; }
  .severity-critical { border-color: #b91c1c; }
  .severity-high { border-color: #ea580c; }
  .severity-medium { border-color: #ca8a04; }
  .severity-low { border-color: #2563eb; }
  .severity-info { border-color: #6b7280; }
  .finding-title { font-weight: 600; }
  .finding-meta, .finding-locations { font-size: 0.85rem; color: #666; }
  ul { list-style: none; padding: 0; }
</style>
</head>
<body>
  <h1>code-analyzer report</h1>
  <div class="summary">
    ${result.summary.totalFindings} finding(s) across ${result.summary.filesAnalyzed} file(s),
    analyzers run: ${escapeHtml(result.summary.analyzersRun.join(", ") || "none")}
  </div>
  ${sections || "<p>No findings.</p>"}
</body>
</html>
`;
  },
};
