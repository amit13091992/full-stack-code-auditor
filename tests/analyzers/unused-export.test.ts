import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unusedExportAnalyzer } from "../../packages/analyzers/src/index.js";
import { buildAnalyzerContext } from "./test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/quality/unused-export");

describe("quality/unused-export", () => {
  it("flags a module with exports and zero incoming IMPORTS edges, with honest low-confidence wording", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "positive"));
    const result = await unusedExportAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.ruleId).toBe("quality/unused-export");
    expect(finding.category).toBe("quality");
    expect(finding.severity).toBe("low");
    expect(finding.confidence).toBeLessThan(0.5);
    expect(finding.status).toBe("detected");
    expect(finding.title).toContain("No other module");
    expect(finding.description).not.toContain("is unused");
    expect(finding.description).toContain("does not mean the exports are unused");
    expect(finding.evidenceIds.length).toBeGreaterThan(0);
    expect(finding.locations.length).toBeGreaterThan(0);
  });

  it("excludes index.ts entry points and modules with an incoming import", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "false-positive"));
    const result = await unusedExportAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(0);
  });
});
