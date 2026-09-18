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
    <div class="finding-code">
      <div class="finding-subhead">${escapeHtml(primary.path)}</div>
      <table class="code-block"><tbody>${rows}</tbody></table>
    </div>`;
}

function renderEvidence(rootPath: string | undefined, evidence: readonly Evidence[]): string {
  if (evidence.length === 0) return "";
  const items = evidence
    .map((ev) => {
      const locations = renderLocations(ev.locations);
      return `<li>${escapeHtml(ev.summary)}${locations ? ` <span class="evidence-location">(${escapeHtml(locations)})</span>` : ""}</li>`;
    })
    .join("");
  return `<div class="finding-evidence"><div class="finding-subhead">Evidence</div><ul>${items}</ul></div>`;
}

function renderRemediation(finding: Finding): string {
  const parts: string[] = [];
  if (finding.remediation) {
    const steps = finding.remediation.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
    const refs = finding.remediation.references.map((ref) => `<li>${escapeHtml(ref)}</li>`).join("");
    parts.push(`
      <div class="finding-remediation">
        <div class="finding-subhead">Remediation</div>
        <p>${escapeHtml(finding.remediation.summary)}</p>
        ${steps ? `<ol>${steps}</ol>` : ""}
        ${refs ? `<ul class="finding-refs">${refs}</ul>` : ""}
      </div>`);
  }
  const tags = [
    finding.cwe ? `<span class="badge tag">${escapeHtml(finding.cwe)}</span>` : "",
    finding.owasp ? `<span class="badge tag">${escapeHtml(finding.owasp)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  if (tags) parts.push(`<div class="finding-tags">${tags}</div>`);
  if (finding.risk) {
    const risk = finding.risk;
    const factors = [
      risk.exploitability !== undefined ? `exploitability ${risk.exploitability.toFixed(2)}` : "",
      risk.reachability !== undefined ? `reachability ${risk.reachability.toFixed(2)}` : "",
      risk.exposure !== undefined ? `exposure ${risk.exposure.toFixed(2)}` : "",
      risk.assetCriticality !== undefined ? `asset criticality ${risk.assetCriticality.toFixed(2)}` : "",
    ]
      .filter(Boolean)
      .join(" &middot; ");
    if (factors) parts.push(`<div class="finding-risk">Risk: ${factors}</div>`);
  }
  return parts.join("");
}

function renderFinding(finding: Finding, evidenceById: Map<string, Evidence>, rootPath: string | undefined): string {
  const locations = escapeHtml(renderLocations(finding.locations));
  const evidence = finding.evidenceIds.map((id) => evidenceById.get(id)).filter((ev): ev is Evidence => ev !== undefined);
  return `
    <li class="finding" data-severity="${escapeHtml(finding.severity)}" data-category="${escapeHtml(finding.category)}" data-rule="${escapeHtml(finding.ruleId)}" data-search="${escapeHtml(`${finding.title} ${finding.description} ${locations}`.toLowerCase())}">
      <details class="finding-details">
        <summary>
          <span class="disclosure-arrow" aria-hidden="true">▸</span>
          <span class="badge severity-${escapeHtml(finding.severity)}">${SEVERITY_ICON[finding.severity] ?? ""} ${escapeHtml(finding.severity)}</span>
          <span class="finding-title">${escapeHtml(finding.title)}</span>
          <span class="finding-summary-meta"><code>${escapeHtml(finding.ruleId)}</code></span>
        </summary>
        <div class="finding-body">
          <div class="finding-meta">
            confidence ${finding.confidence.toFixed(2)} &middot; ${escapeHtml(finding.status)}
          </div>
          <div class="finding-description">${escapeHtml(finding.description)}</div>
          ${locations ? `<div class="finding-locations">${locations}</div>` : ""}
          ${renderCodeBlock(rootPath, finding.locations)}
          ${renderEvidence(rootPath, evidence)}
          ${renderRemediation(finding)}
        </div>
      </details>
    </li>`;
}

function renderDiagnostic(diagnostic: Diagnostic): string {
  const sevClass = diagnostic.severity === "error" ? "high" : diagnostic.severity === "warning" ? "medium" : "info";
  return `
    <li class="diagnostic">
      <span class="badge severity-${sevClass}">${escapeHtml(diagnostic.severity)}</span>
      <code>${escapeHtml(diagnostic.code)}</code>
      <span class="diagnostic-message">${escapeHtml(diagnostic.message)}</span>
      ${diagnostic.filePath ? `<div class="diagnostic-path">${escapeHtml(diagnostic.filePath)}</div>` : ""}
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
  const categoriesSorted = [...byCategory.keys()].sort((a, b) => byCategory.get(b)!.length - byCategory.get(a)!.length);

  const criticalHigh = (bySeverity.get("critical") ?? 0) + (bySeverity.get("high") ?? 0);
  const statCards = [
    renderStatCard("Total findings", summary.totalFindings, "stat-total"),
    renderStatCard("Critical + high", criticalHigh, criticalHigh > 0 ? "stat-danger" : "stat-neutral"),
    renderStatCard("Files analyzed", summary.filesAnalyzed, "stat-neutral"),
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
  h1 { margin: 0 0 0.3rem; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.01em; }
  .page-summary { color: rgba(255,255,255,0.85); font-size: 0.9rem; }
  main { max-width: 1100px; padding: 0 2rem 4rem; }
  .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.9rem; margin: -1.75rem 0 1.75rem; position: relative; z-index: 1; }
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
  .search-row { display: flex; gap: 0.6rem; align-items: stretch; }
  #search { flex: 1; min-width: 0; padding: 0.75rem 1rem; font-size: 0.95rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: 0 2px 8px rgba(17,24,39,0.06); }
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
  .finding-details summary { list-style: none; cursor: pointer; padding: 0.85rem 1.1rem; display: flex; align-items: center; gap: 0.6rem; }
  .finding-details summary::-webkit-details-marker { display: none; }
  .finding-details summary:hover { background: rgba(79, 70, 229, 0.04); }
  .disclosure-arrow { display: inline-block; transition: transform 0.15s; color: var(--text-muted); font-size: 0.8rem; flex-shrink: 0; }
  .finding-details[open] .disclosure-arrow { transform: rotate(90deg); }
  .finding-title { font-weight: 600; font-size: 0.95rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .finding-details[open] .finding-title { white-space: normal; }
  .finding-summary-meta { flex-shrink: 0; }
  .finding-body { padding: 0 1.1rem 1.1rem; }
  .finding-meta { font-size: 0.82rem; color: var(--text-muted); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .finding-meta code, .finding-summary-meta code { background: #f0f0f5; padding: 0.05rem 0.4rem; border-radius: 4px; font-size: 0.78rem; }
  .finding-description { font-size: 0.92rem; color: #374151; }
  .finding-locations { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.4rem; font-family: ui-monospace, "SF Mono", monospace; background: #f9fafb; padding: 0.3rem 0.5rem; border-radius: 6px; display: inline-block; }
  .finding-subhead { font-size: 0.72rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em; color: var(--text-muted); margin: 0.7rem 0 0.3rem; }
  .finding-evidence ul, .finding-remediation ol, .finding-refs { margin: 0.2rem 0 0; padding-left: 1.2rem; font-size: 0.88rem; }
  .finding-evidence { background: #f8f9fc; border-radius: 8px; padding: 0.6rem 0.8rem; margin-top: 0.5rem; }
  .finding-evidence li { color: #374151; }
  .evidence-location { color: var(--text-muted); font-family: ui-monospace, monospace; font-size: 0.78rem; }
  .finding-remediation p { margin: 0.2rem 0; font-size: 0.9rem; }
  .finding-tags { margin-top: 0.5rem; }
  .finding-risk { margin-top: 0.5rem; font-size: 0.82rem; color: var(--text-muted); }
  .finding-code { margin-top: 0.6rem; }
  .code-block { width: 100%; border-collapse: collapse; background: #0d1117; border-radius: 8px; overflow: hidden; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.82rem; }
  .code-block td { padding: 0.15rem 0.7rem; white-space: pre; color: #c9d1d9; }
  .code-lineno { color: #545d68; text-align: right; user-select: none; width: 1%; border-right: 1px solid #21262d; }
  .code-line-highlight { background: rgba(220, 38, 38, 0.18); }
  .code-line-highlight .code-lineno { color: #f87171; }
  .diagnostic-message { font-size: 0.9rem; }
  .diagnostic-path { font-size: 0.8rem; color: var(--text-muted); font-family: ui-monospace, monospace; margin-top: 0.3rem; }
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
  }
  @media (prefers-color-scheme: dark) {
    :root { color-scheme: dark; --bg: #0f1115; --surface: #191c22; --border: #2b2f38; --text: #e5e7eb; --text-muted: #9ca3af; }
    .finding-meta code, .finding-locations, .finding-summary-meta code { background: #10131a; }
    .filter-btn { background: #1f232c; }
    .filter-btn:hover { background: #262b36; }
    .finding-evidence { background: #171a20; }
    .toolbar { background: var(--bg); }
    .toolbar-btn:hover { background: #262b36; color: #a5b4fc; }
    .sev-chip-critical.active { background: rgba(220,38,38,0.15); }
    .sev-chip-high.active { background: rgba(234,88,12,0.15); }
    .sev-chip-medium.active { background: rgba(217,119,6,0.15); }
    .sev-chip-low.active { background: rgba(37,99,235,0.15); }
    .sev-chip-info.active { background: rgba(107,114,128,0.15); }
    .finding-details summary:hover { background: rgba(129, 140, 248, 0.08); }
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
        <h1>codegraph-scan report</h1>
        <div class="page-summary">
          ${summary.totalFindings} finding(s) across ${summary.filesAnalyzed} file(s)
          &middot; ${diagnostics.length} diagnostic(s)
          &middot; analyzers run: ${escapeHtml(summary.analyzersRun.join(", ") || "none")}
        </div>
      </header>
      <main>
        <section id="overview">
          <div class="stats-row">${statCards}</div>
        </section>
        ${
          findings.length === 0
            ? `<div class="empty-state">No findings.</div>`
            : `
        <div class="toolbar">
          <div class="search-row">
            <input id="search" type="search" placeholder="Search title, description, or file path…" autocomplete="off">
            <button type="button" id="expand-all" class="toolbar-btn">Expand all</button>
            <button type="button" id="collapse-all" class="toolbar-btn">Collapse all</button>
          </div>
          <div class="filters">${filters}</div>
          <div id="result-count"></div>
        </div>
        ${categorySections}
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
      var total = items.length;

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
          if (matches) visible++;
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
          countEl.textContent = visible === total ? total + " finding(s)" : "Showing " + visible + " of " + total + " finding(s)";
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
      var allDetails = Array.prototype.slice.call(document.querySelectorAll(".finding-details"));
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
