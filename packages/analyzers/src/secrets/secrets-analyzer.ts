import type { Analyzer, AnalyzerContext, AnalysisResult, Diagnostic, Evidence, EvidenceId, Finding, FindingId, SourceFile, SourceLocation } from "@code-analyzer/core";
import { readSourceTextSafely, resolveRealRoot, SKIP_REASON_MESSAGE, type SkipReason } from "../shared/read-source-text-safely.js";
import { SECRET_PATTERNS } from "./patterns.js";

const RULE_ID_PREFIX = "secrets";
const ANALYZER_ID = "secrets/pattern-scan";

const REDACT_PREFIX_LENGTH = 4;
const REDACTED_SUFFIX = "***REDACTED***";

function offsetToPosition(text: string, offset: number): { readonly line: number; readonly column: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline - 1 };
}

/** Never emits the raw matched secret in any user-facing field (title/description/summary) — only a fixed-length prefix, so redacted output can't leak the credential into JSON/SARIF/HTML reports. */
function redact(match: string): string {
  return `${match.slice(0, REDACT_PREFIX_LENGTH)}${REDACTED_SUFFIX}`;
}

function isSkippableClassification(file: SourceFile): boolean {
  return file.classification === "generated" || file.classification === "vendored";
}

export const secretsAnalyzer: Analyzer = {
  id: ANALYZER_ID,
  name: "Secrets Pattern Scan",
  version: "0.1.0",
  capabilities: { category: "secrets" },

  supports(): boolean {
    return true;
  },

  async analyze(context: AnalyzerContext): Promise<AnalysisResult> {
    const start = Date.now();
    const findings: Finding[] = [];
    const evidence: Evidence[] = [];
    const diagnostics: Diagnostic[] = [];
    const skippedByReason = new Map<SkipReason, number>();
    let index = 0;

    const realRoot = resolveRealRoot(context.config.root);

    for (const file of context.project.files) {
      if (isSkippableClassification(file)) continue;
      const result = readSourceTextSafely(realRoot, file);
      if (!result.ok) {
        skippedByReason.set(result.reason, (skippedByReason.get(result.reason) ?? 0) + 1);
        continue;
      }
      const text = result.text;

      for (const pattern of SECRET_PATTERNS) {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          const matched = match[0];
          const position = offsetToPosition(text, match.index);
          const location: SourceLocation = {
            fileId: file.id,
            path: file.path,
            range: {
              start: { offset: match.index, line: position.line, column: position.column },
              end: { offset: match.index + matched.length, line: position.line, column: position.column + matched.length },
            },
          };
          const redacted = redact(matched);
          const ruleId = pattern.id;

          const ev: Evidence = {
            id: `${RULE_ID_PREFIX}-${index}` as EvidenceId,
            kind: "ast-pattern",
            summary: `${pattern.name} shape matched in ${file.path} (redacted: ${redacted})`,
            locations: [location],
            sourceTool: ANALYZER_ID,
            confidence: pattern.confidence,
          };
          evidence.push(ev);

          findings.push({
            id: `${RULE_ID_PREFIX}-${index}` as FindingId,
            ruleId,
            category: "secrets",
            // Severity is critical-by-default for every pattern here regardless of `confidence`,
            // unlike unused-export's low/low pairing — a credential-shaped string is conventionally
            // treated as critical industry-wide (gitleaks/trufflehog default the same way) because
            // the cost of a false negative (a live key sitting in source control) is severe even
            // when match confidence is only moderate. Confidence expresses "is this really a key,"
            // severity expresses "if it is, how bad" — the two are independent on purpose here.
            severity: "critical",
            confidence: pattern.confidence,
            status: "detected",
            title: `Possible ${pattern.name} found in ${file.path}`,
            description: `${pattern.descriptionTemplate} This is a regex pattern match, not a verified-live-credential check — it does not confirm the credential is active or in use. Matched value redacted: ${redacted}. Rotate the credential if real, and remove it from source control history.`,
            locations: [location],
            evidenceIds: [ev.id],
            cwe: pattern.cwe,
            correlatedFindingIds: [],
          });
          index++;

          if (!regex.global) break;
        }
      }
    }

    for (const [reason, count] of skippedByReason) {
      // Aggregated, one diagnostic per distinct reason rather than per file: a large repo can
      // legitimately have thousands of oversized/binary files, and a diagnostic-per-file would
      // itself become the kind of noise that trains users to ignore diagnostics. The count is
      // exact, not "some files" — so "0 findings" can never be silently confused with "everything
      // was scanned and found clean" (ADR-0004).
      diagnostics.push({
        code: "SECRETS_SCAN_FILES_SKIPPED",
        severity: "info",
        source: ANALYZER_ID,
        message: `Secrets scan skipped ${count} file(s): ${SKIP_REASON_MESSAGE[reason]}.`,
      });
    }

    return {
      analyzerId: ANALYZER_ID,
      findings,
      evidence,
      diagnostics,
      durationMs: Date.now() - start,
    };
  },
};
