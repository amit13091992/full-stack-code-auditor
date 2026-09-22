import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sqlInjectionAnalyzer } from "../../packages/analyzers/src/index.js";
import { buildAnalyzerContext } from "./test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/analyzers/security/sql-injection");

/**
 * Security fixtures + regression tests stage (Section 47) for `security/sql-injection`:
 * real source files run through the real parser -> Call Graph -> Taint Graph ->
 * `sqlInjectionAnalyzer` pipeline via `buildAnalyzerContext` (same helper
 * `tests/analyzers/circular-import.test.ts` uses), not hand-built in-memory
 * `AnalyzerContext`/`Graph` data (that's what `tests/analyzers/sql-injection.test.ts` already
 * covers). Pins real end-to-end behavior so a future Taint Graph or signature-table refactor
 * can't silently break SQL-injection detection without a test failing.
 */
describe("security/sql-injection fixtures (end-to-end)", () => {
  it("flags a true-positive unsanitized req.query -> db.query flow as one critical finding", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "positive"));
    const result = await sqlInjectionAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.ruleId).toBe("security/sql-injection");
    expect(finding.category).toBe("security");
    expect(finding.severity).toBe("critical");
    expect(finding.status).toBe("detected");
    expect(finding.cwe).toBe("CWE-89");
    expect(finding.owasp).toBe("A03:2021");
    // Confidence is a documented "first-cut judgment call" (sql-injection.ts), not a calibrated
    // score - assert a range for a "direct" Call Graph edge, not an exact float.
    expect(finding.confidence).toBeGreaterThanOrEqual(0.7);
    expect(finding.confidence).toBeLessThan(1);
    expect(finding.evidenceIds.length).toBe(2);
    expect(finding.locations.length).toBeGreaterThan(0);
    expect(result.evidence.every((e) => e.locations.length > 0)).toBe(true);
  });

  it("downgrades (not suppresses) a flow through a recognized sanitizer to a low-severity finding", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "sanitized"));
    const result = await sqlInjectionAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.ruleId).toBe("security/sql-injection");
    expect(finding.severity).toBe("low");
    expect(finding.status).toBe("detected");
    expect(finding.cwe).toBe("CWE-89");
    expect(finding.owasp).toBe("A03:2021");
    expect(finding.confidence).toBeGreaterThan(0);
    expect(finding.confidence).toBeLessThan(0.5);
    expect(finding.description).toContain("sanitizer");
  });

  it("produces zero findings when tainted data only reaches non-SQL sinks (log, template render)", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "negative-safe-sink"));
    const result = await sqlInjectionAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(0);
  });

  it("known limitation: an ORM call shape outside the fixed signature table is a documented false negative, not a bug", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "known-limitation"));
    const result = await sqlInjectionAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(0);
  });
});
