import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { circularImportAnalyzer } from "../../packages/analyzers/src/index.js";
import { buildAnalyzerContext } from "./test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/architecture/circular-import");

describe("architecture/circular-import", () => {
  it("flags a two-module import cycle exactly once", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "positive"));
    const result = await circularImportAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.ruleId).toBe("architecture/circular-import");
    expect(finding.category).toBe("architecture");
    expect(finding.severity).toBe("medium");
    expect(finding.confidence).toBeGreaterThan(0.5);
    expect(finding.confidence).toBeLessThanOrEqual(1);
    expect(finding.status).toBe("detected");
    expect(finding.evidenceIds.length).toBeGreaterThan(0);
    expect(finding.locations.length).toBeGreaterThan(0);
    expect(finding.title).toContain("a.ts");
    expect(finding.title).toContain("b.ts");
    expect(result.evidence.every((e) => e.locations.length > 0)).toBe(true);
  });

  it("produces zero findings for an acyclic import chain", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "false-positive"));
    const result = await circularImportAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(0);
  });
});
