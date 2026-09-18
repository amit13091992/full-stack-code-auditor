import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cyclomaticComplexityAnalyzer } from "../../packages/analyzers/src/index.js";
import { buildAnalyzerContext } from "./test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/quality/cyclomatic-complexity");

describe("quality/cyclomatic-complexity", () => {
  it("flags a function with a high complexity-score proxy", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "positive"));
    const result = await cyclomaticComplexityAnalyzer.analyze(context);

    expect(result.findings.length).toBeGreaterThan(0);
    const finding = result.findings[0]!;
    expect(finding.ruleId).toBe("quality/cyclomatic-complexity");
    expect(finding.category).toBe("quality");
    expect(finding.status).toBe("detected");
    expect(finding.confidence).toBeLessThan(0.5);
    expect(finding.description).toContain("proxy");
    expect(finding.evidenceIds.length).toBeGreaterThan(0);
    expect(finding.locations.length).toBeGreaterThan(0);
  });

  it("does not flag a short, unnested function", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "false-positive"));
    const result = await cyclomaticComplexityAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(0);
  });
});
