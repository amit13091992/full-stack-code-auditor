import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { maintainabilityIndexAnalyzer } from "../../packages/analyzers/src/index.js";
import { buildAnalyzerContext } from "./test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/quality/maintainability-index");

describe("quality/maintainability-index", () => {
  it("flags a function with a low simplified maintainability index", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "positive"));
    const result = await maintainabilityIndexAnalyzer.analyze(context);

    expect(result.findings.length).toBeGreaterThan(0);
    const finding = result.findings[0]!;
    expect(finding.ruleId).toBe("quality/maintainability-index");
    expect(finding.category).toBe("quality");
    expect(finding.status).toBe("detected");
    expect(finding.description).toContain("Halstead");
    expect(finding.evidenceIds.length).toBeGreaterThan(0);
  });

  it("does not flag a short, simple function", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "false-positive"));
    const result = await maintainabilityIndexAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(0);
  });
});
