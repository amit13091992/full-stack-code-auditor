import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { duplicationAnalyzer } from "../../packages/analyzers/src/index.js";
import { buildAnalyzerContext } from "./test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/quality/duplication");

describe("quality/duplication", () => {
  it("flags functions with matching structural signatures across modules", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "positive"));
    const result = await duplicationAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.ruleId).toBe("quality/duplication");
    expect(finding.category).toBe("quality");
    expect(finding.status).toBe("detected");
    expect(finding.confidence).toBeLessThan(0.5);
    expect(finding.locations.length).toBeGreaterThanOrEqual(2);
    expect(finding.evidenceIds.length).toBeGreaterThan(0);
  });

  it("does not flag functions with different signatures", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "false-positive"));
    const result = await duplicationAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(0);
  });
});
