import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Diagnostic, Evidence, Finding, FindingCategory, ResultExporter, ScanResult, Severity, SourceLocation } from "@code-analyzer/core";

const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "info"];
const SEVERITY_ICON: Readonly<Record<string, string>> = {
  critical: "⛔",
  high: "🔺",
  medium: "▲",
  low: "●",
  info: "ℹ",
};
const CATEGORY_ICON: Readonly<Record<string, string>> = {
  security: "🛡",
  architecture: "🧩",
  quality: "✨",
  performance: "⚡",
  dependency: "📦",
  secrets: "🔑",
  infrastructure: "🏗",
};
const MAX_SNIPPET_SOURCE_BYTES = 2_000_000; // don't read pathologically large files just to show 5 lines (Section 31)
const SNIPPET_CONTEXT_LINES = 2;

/** Options only the live `scan` command passes (it knows the repo root); the `export` command re-formatting a saved JSON result does not, and gets no snippets — that's expected, not a bug. */
export interface HtmlExportOptions {
  readonly rootPath?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function renderLocations(locations: Finding["locations"]): string {
  return locations.map((loc) => (loc.range ? `${loc.path}:${loc.range.start.line + 1}` : loc.path)).join(", ");
}

function renderLocationChips(locations: Finding["locations"]): string {
  if (locations.length === 0) return "";
  const chips = locations
    .map((loc) => {
      const text = loc.range ? `${loc.path}:${loc.range.start.line + 1}` : loc.path;
      return `<span class="loc-chip">${escapeHtml(text)}</span>`;
    })
    .join("");
  return `<div class="fb-section"><div class="fb-label"><span class="fb-icon">📍</span>Locations</div><div class="loc-chip-row">${chips}</div></div>`;
}

/** Best-effort source snippet for a location. Never throws past this boundary — a missing/renamed/huge file just means no snippet, not a crashed report (Section 31: repository content is hostile input). */
function readSnippet(rootPath: string, location: SourceLocation): { startLine: number; lines: readonly string[]; highlightLine: number } | undefined {
  if (!location.range) return undefined;
  try {
    const root = resolve(rootPath);
    const abs = resolve(root, location.path);
    if (abs !== root && !abs.startsWith(root + sep)) return undefined; // path traversal guard
    if (statSync(abs).size > MAX_SNIPPET_SOURCE_BYTES) return undefined;
    const allLines = readFileSync(abs, "utf-8").split(/\r?\n/);
    const target = location.range.start.line; // 0-based
    const start = Math.max(0, target - SNIPPET_CONTEXT_LINES);
    const end = Math.min(allLines.length, target + SNIPPET_CONTEXT_LINES + 1);
    return { startLine: start + 1, lines: allLines.slice(start, end), highlightLine: target + 1 };
  } catch {
    return undefined;
  }
}

function renderCodeBlock(rootPath: string | undefined, locations: Finding["locations"]): string {
  if (!rootPath) return "";
  const primary = locations.find((loc) => loc.range);
  if (!primary) return "";
  const snippet = readSnippet(rootPath, primary);
  if (!snippet) return "";
  const rows = snippet.lines
    .map((line, i) => {
      const lineNo = snippet.startLine + i;
      const isTarget = lineNo === snippet.highlightLine;
      return `<tr class="${isTarget ? "code-line-highlight" : ""}"><td class="code-lineno">${lineNo}</td><td class="code-text">${escapeHtml(line) || " "}</td></tr>`;
    })
    .join("");
  return `
    <div class="fb-section">
      <div class="fb-label"><span class="fb-icon">💻</span>Source</div>
      <div class="finding-code">
        <div class="code-file-bar">${escapeHtml(primary.path)}</div>
        <table class="code-block"><tbody>${rows}</tbody></table>
      </div>
    </div>`;
}

function renderEvidence(rootPath: string | undefined, evidence: readonly Evidence[]): string {
  if (evidence.length === 0) return "";
  const items = evidence
    .map((ev) => {
      const locations = renderLocations(ev.locations);
      return `
        <li class="evidence-item">
          <span class="evidence-dot" aria-hidden="true"></span>
          <div class="evidence-content">
            <div class="evidence-summary">${escapeHtml(ev.summary)}</div>
            ${locations ? `<span class="loc-chip loc-chip-sm">${escapeHtml(locations)}</span>` : ""}
          </div>
        </li>`;
    })
    .join("");
  return `<div class="fb-section"><div class="fb-label"><span class="fb-icon">🔎</span>Evidence <span class="fb-count">${evidence.length}</span></div><ul class="finding-evidence">${items}</ul></div>`;
}

function renderRemediation(finding: Finding): string {
  const parts: string[] = [];
  if (finding.remediation) {
    const steps = finding.remediation.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
    const refs = finding.remediation.references.map((ref) => `<li>${escapeHtml(ref)}</li>`).join("");
    parts.push(`
      <div class="fb-section fb-section-remediation">
        <div class="fb-label"><span class="fb-icon">🛠</span>Remediation</div>
        <p class="finding-remediation-summary">${escapeHtml(finding.remediation.summary)}</p>
        ${steps ? `<ol class="finding-remediation-steps">${steps}</ol>` : ""}
        ${refs ? `<ul class="finding-refs">${refs}</ul>` : ""}
      </div>`);
  }
  return parts.join("");
}

function renderFindingFooter(finding: Finding): string {
  const cweNum = finding.cwe?.match(/\d+/)?.[0];
  const tags = [
    finding.cwe
      ? cweNum
        ? `<a class="badge tag" href="https://cwe.mitre.org/data/definitions/${cweNum}.html" target="_blank" rel="noopener noreferrer">${escapeHtml(finding.cwe)}</a>`
        : `<span class="badge tag">${escapeHtml(finding.cwe)}</span>`
      : "",
    finding.owasp ? `<span class="badge tag">${escapeHtml(finding.owasp)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  let risk = "";
  if (finding.risk) {
    const factors = [
      finding.risk.exploitability !== undefined ? `exploitability ${finding.risk.exploitability.toFixed(2)}` : "",
      finding.risk.reachability !== undefined ? `reachability ${finding.risk.reachability.toFixed(2)}` : "",
      finding.risk.exposure !== undefined ? `exposure ${finding.risk.exposure.toFixed(2)}` : "",
      finding.risk.assetCriticality !== undefined ? `asset criticality ${finding.risk.assetCriticality.toFixed(2)}` : "",
    ]
      .filter(Boolean)
      .join(" &middot; ");
    if (factors) risk = `<div class="finding-risk">Risk: ${factors}</div>`;
  }
  if (!tags && !risk) return "";
  return `<div class="finding-footer">${tags ? `<div class="finding-tags">${tags}</div>` : ""}${risk}</div>`;
}

function renderFinding(finding: Finding, evidenceById: Map<string, Evidence>, rootPath: string | undefined): string {
  const locations = escapeHtml(renderLocations(finding.locations));
  const evidence = finding.evidenceIds.map((id) => evidenceById.get(id)).filter((ev): ev is Evidence => ev !== undefined);
  const primaryLocation = finding.locations[0];
  const primaryLocationText = primaryLocation ? (primaryLocation.range ? `${primaryLocation.path}:${primaryLocation.range.start.line + 1}` : primaryLocation.path) : "";
  return `
    <li class="finding" data-severity="${escapeHtml(finding.severity)}" data-category="${escapeHtml(finding.category)}" data-rule="${escapeHtml(finding.ruleId)}" data-search="${escapeHtml(`${finding.title} ${finding.description} ${locations}`.toLowerCase())}">
      <details class="finding-details">
        <summary>
          <span class="disclosure-arrow" aria-hidden="true">▸</span>
          <span class="sev-dot sev-dot-${escapeHtml(finding.severity)}" title="${escapeHtml(finding.severity)}"></span>
          <span class="finding-title">${escapeHtml(finding.title)}</span>
          <span class="finding-summary-meta">
            ${primaryLocationText ? `<code class="summary-loc">${escapeHtml(primaryLocationText)}</code>` : ""}
            <code class="summary-rule">${escapeHtml(finding.ruleId)}</code>
          </span>
        </summary>
        <div class="finding-body">
          <div class="finding-meta">
            <span class="badge severity-${escapeHtml(finding.severity)}">${SEVERITY_ICON[finding.severity] ?? ""} ${escapeHtml(finding.severity)}</span>
            ${renderConfidenceMeter(finding.confidence)}
            <span class="status-pill status-${escapeHtml(finding.status)}">${escapeHtml(finding.status.replace(/_/g, " "))}</span>
          </div>
          <p class="finding-description">${escapeHtml(finding.description)}</p>
          ${renderLocationChips(finding.locations)}
          ${renderCodeBlock(rootPath, finding.locations)}
          ${renderEvidence(rootPath, evidence)}
          ${renderRemediation(finding)}
          ${renderFindingFooter(finding)}
        </div>
      </details>
    </li>`;
}

function renderDiagnostic(diagnostic: Diagnostic): string {
  const sevClass = diagnostic.severity === "error" ? "high" : diagnostic.severity === "warning" ? "medium" : "info";
  const cause = diagnostic.cause !== undefined ? (diagnostic.cause instanceof Error ? diagnostic.cause.message : String(diagnostic.cause)) : undefined;
  return `
    <li class="diagnostic">
      <details class="diagnostic-details">
        <summary>
          <span class="disclosure-arrow" aria-hidden="true">▸</span>
          <span class="badge severity-${sevClass}">${escapeHtml(diagnostic.severity)}</span>
          <code>${escapeHtml(diagnostic.code)}</code>
          <span class="diagnostic-message">${escapeHtml(diagnostic.message)}</span>
        </summary>
        <div class="diagnostic-body">
          ${diagnostic.filePath ? `<div class="diagnostic-path">${escapeHtml(diagnostic.filePath)}</div>` : ""}
          <div class="diagnostic-source">source: <code>${escapeHtml(diagnostic.source)}</code></div>
          ${cause ? `<div class="diagnostic-cause">${escapeHtml(cause)}</div>` : ""}
        </div>
      </details>
    </li>`;
}

function renderFilterGroup(label: string, attr: string, counts: ReadonlyMap<string, number>, order?: readonly string[]): string {
  const keys = order ? order.filter((k) => counts.has(k)) : [...counts.keys()].sort();
  if (keys.length === 0) return "";
  const buttons = keys
    .map((key) => {
      const icon = attr === "severity" ? `${SEVERITY_ICON[key] ?? ""} ` : "";
      return `<button type="button" class="filter-btn" data-filter-attr="${escapeHtml(attr)}" data-filter-value="${escapeHtml(key)}">${icon}${escapeHtml(key)} <span class="count">${counts.get(key)}</span></button>`;
    })
    .join("");
  return `
    <div class="filter-group">
      <div class="filter-label">${escapeHtml(label)}</div>
      <div class="filter-buttons">
        <button type="button" class="filter-btn filter-all active" data-filter-attr="${escapeHtml(attr)}" data-filter-value="">All</button>
        ${buttons}
      </div>
    </div>`;
}

function renderSeverityChips(bySeverity: ReadonlyMap<string, number>, total: number): string {
  const present = SEVERITY_ORDER.filter((s) => (bySeverity.get(s) ?? 0) > 0);
  if (present.length === 0) return "";
  const chips = present
    .map((sev) => {
      const count = bySeverity.get(sev) ?? 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return `
        <button type="button" class="filter-btn sev-chip sev-chip-${escapeHtml(sev)}" data-filter-attr="severity" data-filter-value="${escapeHtml(sev)}">
          <span class="sev-chip-icon">${SEVERITY_ICON[sev] ?? ""}</span>
          <span class="sev-chip-count">${count}</span>
          <span class="sev-chip-label">${escapeHtml(sev)}</span>
          <span class="sev-chip-pct">${pct}%</span>
        </button>`;
    })
    .join("");
  return `
    <div class="filter-group">
      <div class="filter-label">Severity</div>
      <div class="sev-chip-row">
        <button type="button" class="filter-btn sev-chip sev-chip-all active" data-filter-attr="severity" data-filter-value="">
          <span class="sev-chip-count">${total}</span>
          <span class="sev-chip-label">All</span>
        </button>
        ${chips}
      </div>
    </div>`;
}

function renderStatCard(label: string, value: number, accentClass: string): string {
  return `<div class="stat-card ${accentClass}"><div class="stat-value">${value}</div><div class="stat-label">${escapeHtml(label)}</div></div>`;
}

function countByRule(findings: readonly Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.ruleId, (counts.get(finding.ruleId) ?? 0) + 1);
  return counts;
}

function groupByCategory(findings: readonly Finding[]): Map<FindingCategory, Finding[]> {
  const groups = new Map<FindingCategory, Finding[]>();
  for (const finding of findings) {
    const bucket = groups.get(finding.category) ?? [];
    bucket.push(finding);
    groups.set(finding.category, bucket);
  }
  return groups;
}

function primaryPath(finding: Finding): string {
  return finding.locations[0]?.path ?? "(unlocated)";
}

function groupByFile(findings: readonly Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const path = primaryPath(finding);
    const bucket = groups.get(path) ?? [];
    bucket.push(finding);
    groups.set(path, bucket);
  }
  return groups;
}

/**
 * A blocking-severity-weighted score, not a calibrated probability of exploitation — the underlying
 * findings carry their own `confidence`/`risk` fields for that. This exists purely to give a report
 * reader the same at-a-glance triage SonarQube's rating or Aikido's risk score gives: is this repo in
 * bad shape or not, without reading every finding. Critical/high findings dominate the score on
 * purpose (a single critical should visibly wreck the grade, the way one broken lock matters more
 * than ten scuffed doors).
 */
const RISK_WEIGHTS: Readonly<Record<string, number>> = { critical: 15, high: 7, medium: 3, low: 1, info: 0.2 };

function computeRiskScore(bySeverity: ReadonlyMap<string, number>): number {
  let penalty = 0;
  for (const [severity, weight] of Object.entries(RISK_WEIGHTS)) penalty += (bySeverity.get(severity) ?? 0) * weight;
  return Math.max(0, Math.round(100 - penalty));
}

function riskGrade(score: number): { readonly letter: string; readonly cssClass: string } {
  if (score >= 90) return { letter: "A", cssClass: "grade-a" };
  if (score >= 75) return { letter: "B", cssClass: "grade-b" };
  if (score >= 55) return { letter: "C", cssClass: "grade-c" };
  if (score >= 30) return { letter: "D", cssClass: "grade-d" };
  return { letter: "E", cssClass: "grade-e" };
}

/**
 * Mirrors SonarQube's quality gate: a binary ship/no-ship verdict derived from the same findings the
 * report already shows, not a separate judgment call. Gate criteria (fail on any critical or high) is
 * intentionally conservative and independent of `--fail-on`, which controls process exit code, not
 * this display.
 */
function computeQualityGate(bySeverity: ReadonlyMap<string, number>): { readonly passed: boolean; readonly reason: string } {
  const critical = bySeverity.get("critical") ?? 0;
  const high = bySeverity.get("high") ?? 0;
  if (critical > 0) return { passed: false, reason: `${critical} critical finding(s)` };
  if (high > 0) return { passed: false, reason: `${high} high-severity finding(s)` };
  return { passed: true, reason: "no critical or high-severity findings" };
}

function renderSeverityBar(bySeverity: ReadonlyMap<string, number>, total: number): string {
  if (total === 0) return "";
  const segments = SEVERITY_ORDER.filter((s) => (bySeverity.get(s) ?? 0) > 0)
    .map((s) => {
      const count = bySeverity.get(s) ?? 0;
      const pct = (count / total) * 100;
      return `<div class="sev-bar-seg sev-bar-${escapeHtml(s)}" style="width:${pct}%" title="${escapeHtml(s)}: ${count}"></div>`;
    })
    .join("");
  return `<div class="sev-bar">${segments}</div>`;
}

function renderConfidenceMeter(confidence: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return `<div class="confidence-meter" title="confidence ${confidence.toFixed(2)}"><div class="confidence-fill" style="width:${pct}%"></div><span class="confidence-label">${pct}%</span></div>`;
}

function renderTopFiles(byFile: ReadonlyMap<string, readonly Finding[]>): string {
  const rows = [...byFile.entries()]
    .map(([path, findings]) => {
      const counts = new Map<string, number>();
      for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
      const weight = SEVERITY_ORDER.reduce((acc, s, i) => acc + (counts.get(s) ?? 0) * (SEVERITY_ORDER.length - i) * 10, 0);
      return { path, findings, counts, weight };
    })
    .sort((a, b) => b.weight - a.weight || b.findings.length - a.findings.length)
    .slice(0, 10);
  if (rows.length === 0) return "";
  const items = rows
    .map(({ path, findings, counts }) => {
      const chips = SEVERITY_ORDER.filter((s) => (counts.get(s) ?? 0) > 0)
        .map((s) => `<span class="mini-chip mini-chip-${escapeHtml(s)}">${counts.get(s)}</span>`)
        .join("");
      return `<li class="top-file-row"><span class="top-file-path">${escapeHtml(path)}</span><span class="top-file-chips">${chips}<span class="top-file-total">${findings.length}</span></span></li>`;
    })
    .join("");
  return `
    <div class="panel top-files-panel">
      <div class="panel-title">Riskiest files</div>
      <ul class="top-file-list">${items}</ul>
    </div>`;
}

function renderFileSections(byFile: ReadonlyMap<string, readonly Finding[]>, evidenceById: Map<string, Evidence>, rootPath: string | undefined): string {
  const filesSorted = [...byFile.keys()].sort((a, b) => byFile.get(b)!.length - byFile.get(a)!.length);
  return filesSorted
    .map((path) => {
      const items = [...byFile.get(path)!]
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
        .map((f) => renderFinding(f, evidenceById, rootPath))
        .join("");
      return `
      <section class="finding-section" data-section-category="__file__">
        <h2 class="section-title file-section-title"><span class="file-icon">📄</span> <code>${escapeHtml(path)}</code> <span class="section-count">${byFile.get(path)!.length}</span></h2>
        <ul class="finding-list">${items}</ul>
      </section>`;
    })
    .join("");
}

/**
 * A self-contained report — no external network calls, no build step to view it (Section 32). It
 * ships inline vanilla JS for client-side filtering/scrollspy (presentation-only) and, when
 * `options.rootPath` is given (the live `scan` command has this; the `export` re-format command
 * does not), reads a small source-code snippet per finding directly off disk — capped in size and
 * traversal-guarded (Section 31: repository content is hostile input).
 */
function renderHtmlReport(result: ScanResult, options?: HtmlExportOptions): string {
  const { findings, diagnostics, summary } = result;
  const rootPath = options?.rootPath;
  const evidenceById = new Map(result.evidence.map((ev) => [ev.id, ev] as const));

  const bySeverity = new Map(Object.entries(summary.findingsBySeverity));
  const byRule = countByRule(findings);
  const byCategory = groupByCategory(findings);
  const byFile = groupByFile(findings);
  const categoriesSorted = [...byCategory.keys()].sort((a, b) => byCategory.get(b)!.length - byCategory.get(a)!.length);

  const riskScore = computeRiskScore(bySeverity);
  const grade = riskGrade(riskScore);
  const gate = computeQualityGate(bySeverity);

  const criticalHigh = (bySeverity.get("critical") ?? 0) + (bySeverity.get("high") ?? 0);
  const statCards = [
    renderStatCard("Total findings", summary.totalFindings, "stat-total"),
    renderStatCard("Critical + high", criticalHigh, criticalHigh > 0 ? "stat-danger" : "stat-neutral"),
    renderStatCard("Files analyzed", summary.filesAnalyzed, "stat-neutral"),
    renderStatCard("Files with findings", byFile.size, "stat-neutral"),
    renderStatCard("Diagnostics", diagnostics.length, diagnostics.length > 0 ? "stat-warn" : "stat-neutral"),
  ].join("");

  const filters = [renderSeverityChips(bySeverity, summary.totalFindings), renderFilterGroup("Rule", "rule", byRule)].join("");

  const navLinks = categoriesSorted
    .map((cat) => `<a href="#cat-${slugify(cat)}" class="nav-link" data-nav-target="cat-${slugify(cat)}">${CATEGORY_ICON[cat] ?? "•"} ${escapeHtml(cat)} <span class="nav-count">${byCategory.get(cat)!.length}</span></a>`)
    .join("");

  const categorySections = categoriesSorted
    .map((cat) => {
      const items = [...byCategory.get(cat)!]
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
        .map((f) => renderFinding(f, evidenceById, rootPath))
        .join("");
      return `
      <section id="cat-${slugify(cat)}" class="finding-section" data-section-category="${escapeHtml(cat)}">
        <h2 class="section-title">${CATEGORY_ICON[cat] ?? ""} ${escapeHtml(cat)} <span class="section-count">${byCategory.get(cat)!.length}</span></h2>
        <ul class="finding-list">${items}</ul>
      </section>`;
    })
    .join("");

  const diagnosticItems = diagnostics.map(renderDiagnostic).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>codegraph-scan report</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f3f4f6; --surface: #ffffff; --border: #e5e7eb; --text: #111827; --text-muted: #6b7280;
    --accent: #4f46e5; --accent-2: #7c3aed;
    --critical: #dc2626; --high: #ea580c; --medium: #d97706; --low: #2563eb; --info: #6b7280;
    --radius: 10px; --sidebar-w: 240px;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; color: var(--text); background: var(--bg); line-height: 1.5; -webkit-font-smoothing: antialiased; }
  .app { display: grid; grid-template-columns: var(--sidebar-w) 1fr; min-height: 100vh; }
  .sidebar { background: #1e2028; color: #e5e7eb; padding: 1.5rem 1rem; position: sticky; top: 0; height: 100vh; overflow-y: auto; border-right: 1px solid #2a2d38; }
  .brand { font-weight: 700; font-size: 1.05rem; margin-bottom: 1.5rem; padding: 0 0.5rem; display: flex; align-items: center; gap: 0.4rem; }
  .brand-dot { width: 9px; height: 9px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent-2)); display: inline-block; }
  nav.side-nav { display: flex; flex-direction: column; gap: 0.15rem; }
  .nav-section-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin: 1rem 0.5rem 0.4rem; }
  .nav-link { color: #d1d5db; text-decoration: none; padding: 0.5rem 0.6rem; border-radius: 8px; font-size: 0.87rem; display: flex; align-items: center; gap: 0.4rem; justify-content: space-between; }
  .nav-link:hover { background: #1f2130; color: #fff; }
  .nav-link.active { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; }
  .nav-count { font-size: 0.72rem; opacity: 0.75; }
  .content { min-width: 0; }
  header.page-header { background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%); color: #fff; padding: 2rem 2.25rem; }
  .page-header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap; }
  h1 { margin: 0 0 0.3rem; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.01em; }
  .page-summary { color: rgba(255,255,255,0.85); font-size: 0.85rem; display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .page-summary code { background: rgba(255,255,255,0.15); padding: 0.05rem 0.4rem; border-radius: 4px; }
  .project-id { font-weight: 600; }
  .gate-badge { display: flex; align-items: center; gap: 0.6rem; background: rgba(255,255,255,0.12); border: 1.5px solid rgba(255,255,255,0.3); border-radius: 999px; padding: 0.45rem 1rem 0.45rem 0.7rem; }
  .gate-icon { width: 1.6rem; height: 1.6rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.9rem; flex-shrink: 0; }
  .gate-pass .gate-icon { background: #22c55e; color: #063d1c; }
  .gate-fail .gate-icon { background: #f87171; color: #4c0519; }
  .gate-text { display: flex; flex-direction: column; line-height: 1.15; }
  .gate-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.85; }
  .gate-status { font-size: 0.95rem; font-weight: 700; }
  main { max-width: 1100px; padding: 0 2rem 4rem; }
  .overview-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.9rem; margin: -1.75rem 0 0.9rem; position: relative; z-index: 1; }
  .panel { background: var(--surface); border-radius: var(--radius); box-shadow: 0 4px 14px rgba(17,24,39,0.08); }
  .grade-panel { display: flex; align-items: center; gap: 1.1rem; padding: 1.2rem 1.4rem; }
  .grade-circle { width: 3.4rem; height: 3.4rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 800; color: #fff; flex-shrink: 0; }
  .grade-circle.grade-a { background: #16a34a; }
  .grade-circle.grade-b { background: #65a30d; }
  .grade-circle.grade-c { background: #d97706; }
  .grade-circle.grade-d { background: #ea580c; }
  .grade-circle.grade-e { background: #dc2626; }
  .grade-meta { flex: 1; min-width: 0; }
  .grade-score { font-size: 1.3rem; font-weight: 700; line-height: 1; }
  .grade-max { font-size: 0.85rem; font-weight: 500; color: var(--text-muted); }
  .grade-caption { font-size: 0.78rem; color: var(--text-muted); margin: 0.25rem 0 0.55rem; }
  .sev-bar { display: flex; height: 8px; border-radius: 999px; overflow: hidden; background: var(--border); }
  .sev-bar-seg { height: 100%; }
  .sev-bar-critical { background: var(--critical); }
  .sev-bar-high { background: var(--high); }
  .sev-bar-medium { background: var(--medium); }
  .sev-bar-low { background: var(--low); }
  .sev-bar-info { background: var(--info); }
  .top-files-panel { padding: 1rem 1.3rem; overflow: hidden; }
  .panel-title { font-size: 0.72rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.6rem; }
  .top-file-list { list-style: none; margin: 0; padding: 0; max-height: 8.5rem; overflow-y: auto; }
  .top-file-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; padding: 0.32rem 0; font-size: 0.82rem; border-top: 1px solid var(--border); }
  .top-file-row:first-child { border-top: none; }
  .top-file-path { font-family: ui-monospace, "SF Mono", monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .top-file-chips { display: flex; align-items: center; gap: 0.25rem; flex-shrink: 0; }
  .mini-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 1.1rem; height: 1.1rem; border-radius: 999px; font-size: 0.68rem; font-weight: 700; color: #fff; padding: 0 0.3rem; }
  .mini-chip-critical { background: var(--critical); }
  .mini-chip-high { background: var(--high); }
  .mini-chip-medium { background: var(--medium); }
  .mini-chip-low { background: var(--low); }
  .mini-chip-info { background: var(--info); }
  .top-file-total { font-weight: 700; font-size: 0.78rem; color: var(--text-muted); margin-left: 0.2rem; }
  .confidence-meter { position: relative; width: 5rem; height: 6px; border-radius: 999px; background: var(--border); overflow: visible; display: inline-flex; align-items: center; }
  .confidence-fill { height: 100%; border-radius: 999px; background: var(--accent); }
  .confidence-label { font-size: 0.72rem; color: var(--text-muted); margin-left: 0.4rem; white-space: nowrap; }
  .status-pill { font-size: 0.72rem; font-weight: 600; padding: 0.08rem 0.5rem; border-radius: 999px; background: #f0f0f5; color: var(--text-muted); text-transform: capitalize; }
  .status-pill.status-confirmed, .status-pill.status-runtime_confirmed { background: #dcfce7; color: #166534; }
  .status-pill.status-false_positive { background: #f3f4f6; color: #6b7280; text-decoration: line-through; }
  .view-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .view-toggle .toolbar-btn { border: none; border-radius: 0; }
  .view-toggle .toolbar-btn + .toolbar-btn { border-left: 1px solid var(--border); }
  .view-toggle .toolbar-btn.active { background: var(--accent); color: #fff; }
  .file-section-title code { font-size: 0.95rem; background: none; }
  .file-icon { font-size: 0.95rem; }
  .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.9rem; margin-bottom: 1.75rem; position: relative; z-index: 1; }
  .stat-card { background: var(--surface); border-radius: var(--radius); padding: 1.1rem 1.3rem; box-shadow: 0 4px 14px rgba(17,24,39,0.08); border-top: 3px solid var(--border); }
  .stat-card.stat-danger { border-top-color: var(--critical); }
  .stat-card.stat-warn { border-top-color: var(--medium); }
  .stat-card.stat-total { border-top-color: var(--accent); }
  .stat-card.stat-neutral { border-top-color: var(--info); }
  .stat-value { font-size: 1.8rem; font-weight: 700; line-height: 1; }
  .stat-label { font-size: 0.76rem; color: var(--text-muted); margin-top: 0.35rem; text-transform: uppercase; letter-spacing: 0.03em; }
  h2.section-title { font-size: 1.1rem; font-weight: 700; margin: 2.5rem 0 1rem; display: flex; align-items: center; gap: 0.5rem; scroll-margin-top: 1rem; }
  .section-count { font-size: 0.78rem; font-weight: 600; color: var(--text-muted); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 0.1rem 0.55rem; }
  .toolbar { position: sticky; top: 0; background: var(--bg); padding-top: 1rem; z-index: 5; }
  .search-row { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: stretch; }
  #search { flex: 1 1 220px; min-width: 0; padding: 0.75rem 1rem; font-size: 0.95rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: 0 2px 8px rgba(17,24,39,0.06); }
  .view-toggle, #expand-all, #collapse-all { flex-shrink: 0; }
  #search:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .toolbar-btn { border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius); padding: 0 1rem; font-size: 0.85rem; font-weight: 600; color: var(--text); cursor: pointer; white-space: nowrap; transition: background 0.12s, border-color 0.12s; }
  .toolbar-btn:hover { background: #eef2ff; border-color: #c7d2fe; color: var(--accent); }
  .filters { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.1rem 1.3rem; margin-top: 1rem; box-shadow: 0 1px 3px rgba(17,24,39,0.04); }
  .filter-group { margin-bottom: 1.1rem; }
  .filter-group:last-child { margin-bottom: 0; }
  .filter-label { font-size: 0.72rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.55rem; }
  .filter-buttons { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .filter-btn { border: 1px solid var(--border); background: #fafafa; border-radius: 999px; padding: 0.32rem 0.75rem; font-size: 0.82rem; cursor: pointer; color: var(--text); transition: background 0.1s, color 0.1s, border-color 0.1s, transform 0.08s; }
  .filter-btn:hover { background: #eef2ff; border-color: #c7d2fe; }
  .filter-btn:active { transform: scale(0.97); }
  .filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .filter-btn .count { opacity: 0.65; margin-left: 0.2rem; }
  .sev-chip-row { display: flex; flex-wrap: wrap; gap: 0.55rem; }
  .sev-chip {
    display: flex; align-items: baseline; gap: 0.4rem; padding: 0.55rem 0.9rem; border-radius: 10px;
    border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; text-align: left;
    transition: transform 0.1s, box-shadow 0.1s, border-color 0.1s;
  }
  .sev-chip:hover { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(17,24,39,0.1); }
  .sev-chip:active { transform: translateY(0); }
  .sev-chip-icon { font-size: 0.85rem; }
  .sev-chip-count { font-weight: 700; font-size: 1rem; }
  .sev-chip-label { font-size: 0.78rem; text-transform: capitalize; color: var(--text-muted); }
  .sev-chip-pct { font-size: 0.7rem; color: var(--text-muted); opacity: 0.7; margin-left: auto; }
  .sev-chip-all { border-color: var(--accent); }
  .sev-chip-all .sev-chip-label { color: var(--accent); font-weight: 600; }
  .sev-chip.active { border-width: 2px; box-shadow: 0 2px 10px rgba(17,24,39,0.12); }
  .sev-chip-critical.active, .sev-chip-critical:hover { border-color: var(--critical); }
  .sev-chip-critical.active { background: #fef2f2; }
  .sev-chip-high.active, .sev-chip-high:hover { border-color: var(--high); }
  .sev-chip-high.active { background: #fff7ed; }
  .sev-chip-medium.active, .sev-chip-medium:hover { border-color: var(--medium); }
  .sev-chip-medium.active { background: #fffbeb; }
  .sev-chip-low.active, .sev-chip-low:hover { border-color: var(--low); }
  .sev-chip-low.active { background: #eff6ff; }
  .sev-chip-info.active, .sev-chip-info:hover { border-color: var(--info); }
  .sev-chip-info.active { background: #f9fafb; }
  .sev-chip-all.active { background: var(--accent); border-color: var(--accent); }
  .sev-chip-all.active .sev-chip-label, .sev-chip-all.active .sev-chip-count { color: #fff; }
  #result-count { color: var(--text-muted); font-size: 0.86rem; margin: 0.85rem 0; font-weight: 500; }
  ul.finding-list, ul#diagnostics { list-style: none; padding: 0; margin: 0; }
  .finding, .diagnostic { border-left: 4px solid var(--info); margin-bottom: 0.55rem; background: var(--surface); border-radius: 0 var(--radius) var(--radius) 0; box-shadow: 0 1px 3px rgba(17,24,39,0.05); transition: box-shadow 0.1s; overflow: hidden; }
  .finding:hover { box-shadow: 0 3px 10px rgba(17,24,39,0.09); }
  .finding[hidden], .finding-section[hidden] { display: none; }
  .finding[data-severity="critical"] { border-color: var(--critical); }
  .finding[data-severity="high"] { border-color: var(--high); }
  .finding[data-severity="medium"] { border-color: var(--medium); }
  .finding[data-severity="low"] { border-color: var(--low); }
  .finding[data-severity="info"] { border-color: var(--info); }
  .finding-details summary { list-style: none; cursor: pointer; padding: 0.85rem 1.1rem; display: flex; align-items: center; gap: 0.65rem; }
  .finding-details summary::-webkit-details-marker { display: none; }
  .finding-details summary:hover { background: rgba(79, 70, 229, 0.04); }
  .disclosure-arrow { display: inline-block; transition: transform 0.15s; color: var(--text-muted); font-size: 0.8rem; flex-shrink: 0; }
  .finding-details[open] .disclosure-arrow { transform: rotate(90deg); }
  .finding-details[open] summary { border-bottom: 1px solid var(--border); background: rgba(79, 70, 229, 0.03); }
  .sev-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .sev-dot-critical { background: var(--critical); box-shadow: 0 0 0 3px rgba(220,38,38,0.15); }
  .sev-dot-high { background: var(--high); box-shadow: 0 0 0 3px rgba(234,88,12,0.15); }
  .sev-dot-medium { background: var(--medium); box-shadow: 0 0 0 3px rgba(217,119,6,0.15); }
  .sev-dot-low { background: var(--low); box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
  .sev-dot-info { background: var(--info); box-shadow: 0 0 0 3px rgba(107,114,128,0.15); }
  .finding-title { font-weight: 600; font-size: 0.93rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .finding-details[open] .finding-title { white-space: normal; }
  .finding-summary-meta { flex-shrink: 0; display: flex; gap: 0.4rem; }
  .summary-loc { color: var(--accent); }
  @media (max-width: 860px) { .summary-loc { display: none; } }
  .finding-body { padding: 1rem 1.1rem 1.2rem; display: flex; flex-direction: column; gap: 1rem; }
  .finding-meta { font-size: 0.82rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .finding-meta code, .finding-summary-meta code { background: #f0f0f5; padding: 0.05rem 0.4rem; border-radius: 4px; font-size: 0.78rem; }
  .finding-description { font-size: 0.92rem; line-height: 1.55; color: #374151; margin: 0; }
  .fb-section { display: flex; flex-direction: column; gap: 0.5rem; }
  .fb-label { font-size: 0.7rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; color: var(--text-muted); display: flex; align-items: center; gap: 0.35rem; }
  .fb-icon { font-size: 0.82rem; }
  .fb-count { font-weight: 600; color: var(--text-muted); background: var(--border); border-radius: 999px; padding: 0 0.4rem; font-size: 0.68rem; text-transform: none; letter-spacing: 0; }
  .loc-chip-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .loc-chip { font-family: ui-monospace, "SF Mono", monospace; font-size: 0.78rem; color: var(--text-muted); background: #f3f4f6; border: 1px solid var(--border); padding: 0.2rem 0.55rem; border-radius: 6px; }
  .loc-chip-sm { font-size: 0.74rem; padding: 0.1rem 0.45rem; }
  .fb-section-remediation { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 0.85rem 1rem; }
  .fb-section-remediation .fb-label { color: #15803d; }
  .finding-remediation-summary { margin: 0.1rem 0 0.3rem; font-size: 0.9rem; color: #166534; }
  .finding-remediation-steps, .finding-refs { margin: 0.2rem 0 0; padding-left: 1.2rem; font-size: 0.88rem; }
  .finding-evidence { list-style: none; margin: 0; background: #f8f9fc; border-radius: 10px; padding: 0.5rem 0.7rem; display: flex; flex-direction: column; }
  .evidence-item { display: flex; align-items: flex-start; gap: 0.55rem; padding: 0.5rem 0.2rem; border-top: 1px solid #eceef4; }
  .evidence-item:first-child { border-top: none; }
  .evidence-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); margin-top: 0.45rem; flex-shrink: 0; }
  .evidence-content { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
  .evidence-summary { font-size: 0.88rem; color: #374151; line-height: 1.45; }
  .finding-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 0.6rem; padding-top: 0.15rem; border-top: 1px solid var(--border); }
  .finding-tags { display: flex; gap: 0.3rem; flex-wrap: wrap; }
  .finding-risk { font-size: 0.8rem; color: var(--text-muted); }
  .finding-code { display: flex; flex-direction: column; }
  .code-file-bar { font-family: ui-monospace, "SF Mono", monospace; font-size: 0.75rem; color: #9ca3af; background: #161b22; padding: 0.35rem 0.7rem; border-radius: 8px 8px 0 0; border: 1px solid #21262d; border-bottom: none; }
  .code-block { width: 100%; border-collapse: collapse; background: #0d1117; border-radius: 0 0 8px 8px; overflow: hidden; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.82rem; border: 1px solid #21262d; border-top: none; }
  .code-block td { padding: 0.15rem 0.7rem; white-space: pre; color: #c9d1d9; }
  .code-lineno { color: #545d68; text-align: right; user-select: none; width: 1%; border-right: 1px solid #21262d; }
  .code-line-highlight { background: rgba(220, 38, 38, 0.18); }
  .code-line-highlight .code-lineno { color: #f87171; }
  .diagnostic-details summary { list-style: none; cursor: pointer; padding: 0.7rem 1rem; display: flex; align-items: center; gap: 0.6rem; }
  .diagnostic-details summary::-webkit-details-marker { display: none; }
  .diagnostic-details summary:hover { background: rgba(79, 70, 229, 0.04); }
  .diagnostic-details[open] .disclosure-arrow { transform: rotate(90deg); }
  .diagnostic-message { font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .diagnostic-details[open] .diagnostic-message { white-space: normal; }
  .diagnostic-body { padding: 0 1rem 0.85rem 2.4rem; }
  .diagnostic-path { font-size: 0.8rem; color: var(--text-muted); font-family: ui-monospace, monospace; }
  .diagnostic-source { font-size: 0.78rem; color: var(--text-muted); margin-top: 0.3rem; }
  .diagnostic-source code { background: #f0f0f5; padding: 0.05rem 0.4rem; border-radius: 4px; }
  .diagnostic-cause { font-size: 0.82rem; color: #7f1d1d; background: #fef2f2; border-radius: 6px; padding: 0.4rem 0.6rem; margin-top: 0.4rem; font-family: ui-monospace, monospace; white-space: pre-wrap; }
  .badge { border-radius: 999px; padding: 0.15rem 0.6rem; font-size: 0.74rem; font-weight: 600; color: #fff; white-space: nowrap; }
  .badge.tag { background: #6d28d9; margin-right: 0.3rem; }
  .badge.severity-critical { background: var(--critical); }
  .badge.severity-high { background: var(--high); }
  .badge.severity-medium { background: var(--medium); }
  .badge.severity-low { background: var(--low); }
  .badge.severity-info { background: var(--info); }
  .empty-state { text-align: center; color: var(--text-muted); padding: 2.5rem 0; background: var(--surface); border-radius: var(--radius); border: 1px dashed var(--border); }
  @media (max-width: 860px) {
    .app { grid-template-columns: 1fr; }
    .sidebar { position: static; height: auto; display: flex; overflow-x: auto; padding: 0.75rem; gap: 0.4rem; align-items: center; }
    .brand { margin-bottom: 0; flex-shrink: 0; }
    nav.side-nav { flex-direction: row; }
    .nav-section-label { display: none; }
    .nav-link { white-space: nowrap; }
    main { padding: 0 1rem 3rem; }
    header.page-header { padding: 1.5rem; }
    .overview-grid { grid-template-columns: 1fr; margin-top: -1.25rem; }
  }
  @media (max-width: 640px) {
    #search { flex-basis: 100%; }
    #expand-all, #collapse-all { padding: 0 0.6rem; }
    .toolbar { position: static; }
    .finding-details summary { flex-wrap: wrap; align-items: flex-start; row-gap: 0.35rem; }
    .finding-details summary .disclosure-arrow, .finding-details summary .sev-dot { margin-top: 0.3rem; }
    .finding-title { white-space: normal; }
    .finding-summary-meta { flex-basis: 100%; padding-left: 1.5rem; }
    .grade-panel { flex-wrap: wrap; }
    .top-file-chips { flex-wrap: wrap; justify-content: flex-end; }
    .diagnostic-details summary { flex-wrap: wrap; align-items: flex-start; row-gap: 0.35rem; }
    .diagnostic-details summary .disclosure-arrow { margin-top: 0.3rem; }
    .diagnostic-message { white-space: normal; }
  }
  @media (prefers-color-scheme: dark) {
    :root { color-scheme: dark; --bg: #0f1115; --surface: #191c22; --border: #2b2f38; --text: #e5e7eb; --text-muted: #9ca3af; }
    .finding-meta code, .finding-summary-meta code { background: #10131a; }
    .filter-btn { background: #1f232c; }
    .filter-btn:hover { background: #262b36; }
    .finding-evidence { background: #171a20; }
    .evidence-item { border-top-color: #262b36; }
    .evidence-summary { color: #d1d5db; }
    .loc-chip { background: #171a20; border-color: #2b2f38; color: #9ca3af; }
    .fb-count { background: #262b36; color: #9ca3af; }
    .fb-section-remediation { background: rgba(34,197,94,0.08); border-color: rgba(34,197,94,0.25); }
    .fb-section-remediation .fb-label { color: #4ade80; }
    .finding-remediation-summary { color: #86efac; }
    .finding-footer { border-top-color: var(--border); }
    .finding-details[open] summary { background: rgba(129, 140, 248, 0.06); border-bottom-color: var(--border); }
    .toolbar { background: var(--bg); }
    .toolbar-btn:hover { background: #262b36; color: #a5b4fc; }
    .sev-chip-critical.active { background: rgba(220,38,38,0.15); }
    .sev-chip-high.active { background: rgba(234,88,12,0.15); }
    .sev-chip-medium.active { background: rgba(217,119,6,0.15); }
    .sev-chip-low.active { background: rgba(37,99,235,0.15); }
    .sev-chip-info.active { background: rgba(107,114,128,0.15); }
    .finding-details summary:hover { background: rgba(129, 140, 248, 0.08); }
    .status-pill { background: #262b36; color: #9ca3af; }
    .status-pill.status-confirmed, .status-pill.status-runtime_confirmed { background: rgba(34,197,94,0.18); color: #4ade80; }
    .status-pill.status-false_positive { background: #262b36; color: #6b7280; }
    .view-toggle .toolbar-btn.active { color: #fff; }
    .diagnostic-source code { background: #10131a; }
    .diagnostic-details summary:hover { background: rgba(129, 140, 248, 0.08); }
    .diagnostic-cause { background: rgba(220,38,38,0.12); color: #fca5a5; }
  }
</style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand"><span class="brand-dot"></span> codegraph-scan</div>
      <nav class="side-nav">
        <a href="#overview" class="nav-link" data-nav-target="overview">📊 Overview</a>
        <div class="nav-section-label">Findings</div>
        ${navLinks}
        <div class="nav-section-label">&nbsp;</div>
        <a href="#diagnostics-section" class="nav-link" data-nav-target="diagnostics-section">🩺 Diagnostics <span class="nav-count">${diagnostics.length}</span></a>
      </nav>
    </aside>
    <div class="content">
      <header class="page-header">
        <div class="page-header-top">
          <div>
            <h1>codegraph-scan report</h1>
            <div class="page-summary">
              <code class="project-id">${escapeHtml(result.scan.projectId)}</code>
              &middot; profile <strong>${escapeHtml(result.scan.profile)}</strong>
              &middot; ${escapeHtml(result.scan.mode)} scan
              ${result.scan.headCommit ? `&middot; <code>${escapeHtml(result.scan.headCommit.slice(0, 12))}</code>` : ""}
              &middot; ${escapeHtml(new Date(result.scan.timing.startedAt).toISOString().replace("T", " ").slice(0, 16))} UTC
            </div>
          </div>
          <div class="gate-badge gate-${gate.passed ? "pass" : "fail"}">
            <span class="gate-icon">${gate.passed ? "✓" : "✕"}</span>
            <span class="gate-text">
              <span class="gate-label">Quality Gate</span>
              <span class="gate-status">${gate.passed ? "Passed" : "Failed"}</span>
            </span>
          </div>
        </div>
      </header>
      <main>
        <section id="overview">
          <div class="overview-grid">
            <div class="panel grade-panel">
              <div class="grade-circle ${grade.cssClass}">${grade.letter}</div>
              <div class="grade-meta">
                <div class="grade-score">${riskScore}<span class="grade-max">/100</span></div>
                <div class="grade-caption">risk score &middot; ${escapeHtml(gate.reason)}</div>
                ${renderSeverityBar(bySeverity, summary.totalFindings)}
              </div>
            </div>
            ${renderTopFiles(byFile)}
          </div>
          <div class="stats-row">${statCards}</div>
        </section>
        ${
          findings.length === 0
            ? `<div class="empty-state">No findings.</div>`
            : `
        <div class="toolbar">
          <div class="search-row">
            <input id="search" type="search" placeholder="Search title, description, or file path…" autocomplete="off">
            <div class="view-toggle" role="group" aria-label="Group findings by">
              <button type="button" class="toolbar-btn view-btn active" data-view="category">By category</button>
              <button type="button" class="toolbar-btn view-btn" data-view="file">By file</button>
            </div>
            <button type="button" id="expand-all" class="toolbar-btn">Expand all</button>
            <button type="button" id="collapse-all" class="toolbar-btn">Collapse all</button>
          </div>
          <div class="filters">${filters}</div>
          <div id="result-count"></div>
        </div>
        <div id="view-category">${categorySections}</div>
        <div id="view-file" hidden>${renderFileSections(byFile, evidenceById, rootPath)}</div>
        `
        }
        <section id="diagnostics-section">
          <h2 class="section-title">🩺 Diagnostics <span class="section-count">${diagnostics.length}</span></h2>
          ${diagnostics.length === 0 ? `<div class="empty-state">No diagnostics — every file was parsed without issue.</div>` : `<ul id="diagnostics">${diagnosticItems}</ul>`}
        </section>
      </main>
    </div>
  </div>
  <script>
    (function () {
      var activeFilters = {};
      var searchTerm = "";
      var items = Array.prototype.slice.call(document.querySelectorAll(".finding"));
      var sections = Array.prototype.slice.call(document.querySelectorAll(".finding-section"));
      var countEl = document.getElementById("result-count");
      var viewCategoryEl = document.getElementById("view-category");
      var viewFileEl = document.getElementById("view-file");
      // Findings render once per view (category vs. file grouping) so switching views needs no
      // re-render; counting must therefore scope to the currently visible view, not all DOM copies.
      var totalPerView = viewCategoryEl ? viewCategoryEl.querySelectorAll(".finding").length : items.length;

      function apply() {
        var visible = 0;
        items.forEach(function (item) {
          var matches = Object.keys(activeFilters).every(function (attr) {
            return item.getAttribute("data-" + attr) === activeFilters[attr];
          });
          if (matches && searchTerm) {
            matches = item.getAttribute("data-search").indexOf(searchTerm) !== -1;
          }
          item.hidden = !matches;
          var container = item.closest("#view-category, #view-file");
          if (matches && container && !container.hidden) visible++;
          if (searchTerm) {
            var details = item.querySelector(".finding-details");
            if (details) details.open = matches;
          }
        });
        sections.forEach(function (section) {
          var anyVisible = Array.prototype.slice.call(section.querySelectorAll(".finding")).some(function (f) { return !f.hidden; });
          section.hidden = !anyVisible;
        });
        if (countEl) {
          countEl.textContent = visible === totalPerView ? visible + " finding(s)" : "Showing " + visible + " of " + totalPerView + " finding(s)";
        }
      }

      document.querySelectorAll(".filter-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var attr = btn.getAttribute("data-filter-attr");
          var value = btn.getAttribute("data-filter-value");
          var group = btn.closest(".filter-group");
          group.querySelectorAll(".filter-btn").forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          if (value) { activeFilters[attr] = value; } else { delete activeFilters[attr]; }
          apply();
        });
      });

      document.querySelectorAll(".view-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          document.querySelectorAll(".view-btn").forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          var view = btn.getAttribute("data-view");
          if (viewCategoryEl) viewCategoryEl.hidden = view !== "category";
          if (viewFileEl) viewFileEl.hidden = view !== "file";
          apply();
        });
      });

      var searchInput = document.getElementById("search");
      if (searchInput) {
        searchInput.addEventListener("input", function () {
          searchTerm = searchInput.value.trim().toLowerCase();
          apply();
        });
      }

      apply();

      var expandAllBtn = document.getElementById("expand-all");
      var collapseAllBtn = document.getElementById("collapse-all");
      var allDetails = Array.prototype.slice.call(document.querySelectorAll(".finding-details, .diagnostic-details"));
      if (expandAllBtn) {
        expandAllBtn.addEventListener("click", function () {
          allDetails.forEach(function (d) { d.open = true; });
        });
      }
      if (collapseAllBtn) {
        collapseAllBtn.addEventListener("click", function () {
          allDetails.forEach(function (d) { d.open = false; });
        });
      }

      // Scrollspy: highlight the sidebar link for whichever section is in view.
      var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav-link"));
      var navByTarget = {};
      navLinks.forEach(function (link) { navByTarget[link.getAttribute("data-nav-target")] = link; });
      var observedSections = ["overview"].concat(sections.map(function (s) { return s.id; })).concat(["diagnostics-section"]);
      if ("IntersectionObserver" in window) {
        var observer = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) {
                navLinks.forEach(function (l) { l.classList.remove("active"); });
                var link = navByTarget[entry.target.id];
                if (link) link.classList.add("active");
              }
            });
          },
          { rootMargin: "-40% 0px -50% 0px" },
        );
        observedSections.forEach(function (id) {
          var el = document.getElementById(id);
          if (el) observer.observe(el);
        });
      }
    })();
  </script>
</body>
</html>
`;
}

export const htmlExporter: ResultExporter = {
  format: "html",
  export(result: ScanResult): string {
    return renderHtmlReport(result);
  },
};

export { renderHtmlReport };
