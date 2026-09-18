import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintStyleRulesAnalyzer } from "../../packages/analyzers/src/index.js";
import { buildAnalyzerContext } from "./test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/quality/lint-style-rules");

describe("quality/lint-style-rules", () => {
  it("flags too many parameters, an oversized file, and a module with too many exports", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "positive"));
    const result = await lintStyleRulesAnalyzer.analyze(context);

    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    for (const finding of result.findings) {
      expect(finding.ruleId).toBe("quality/lint-style-rules");
      expect(finding.category).toBe("quality");
      expect(finding.status).toBe("detected");
      expect(finding.evidenceIds.length).toBeGreaterThan(0);
      expect(finding.locations.length).toBeGreaterThan(0);
    }
    expect(result.findings.some((f) => f.title.includes("too many parameters"))).toBe(true);
    expect(result.findings.some((f) => f.title.includes("unusually large"))).toBe(true);
    expect(result.findings.some((f) => f.title.includes("too many symbols"))).toBe(true);
  });

  it("does not flag a small file with few parameters and few exports", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "false-positive"));
    const result = await lintStyleRulesAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(0);
  });
});
