import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unresolvedImportAnalyzer } from "../../packages/analyzers/src/index.js";
import { buildAnalyzerContext } from "./test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/architecture/unresolved-import");

describe("architecture/unresolved-import", () => {
  it("flags a broken relative import but not a bare specifier in the same file", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "positive"));
    const result = await unresolvedImportAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.ruleId).toBe("architecture/unresolved-import");
    expect(finding.category).toBe("architecture");
    expect(finding.severity).toBe("medium");
    expect(finding.confidence).toBeGreaterThan(0.5);
    expect(finding.status).toBe("detected");
    expect(finding.title).toContain("./does-not-exist.js");
    expect(finding.title).not.toContain("react");
    expect(finding.evidenceIds.length).toBeGreaterThan(0);
    expect(finding.locations.length).toBeGreaterThan(0);
  });

  it("produces zero findings when every relative import resolves and bare specifiers are present", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "false-positive"));
    const result = await unresolvedImportAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(0);
  });
});
