import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SourceFile } from "../../packages/core/src/index.js";
import { parseCoveragePy, parseIstanbulJson, parseLcov } from "../../packages/integrations/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { noopLogger } from "../../packages/core/src/index.js";
import { configFor } from "../analyzers/test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/coverage");
const COLLECTED_AT = "2026-09-19T00:00:00.000Z";

async function discoverFiles(root: string): Promise<readonly SourceFile[]> {
  const config = configFor(root);
  const project = await projectModelDiscoverer.discover(root, config, noopLogger);
  return project.files;
}

describe("parseLcov", () => {
  it("maps covered/uncovered files, leaves the unmentioned file unknown, and diagnostics the unmappable path", async () => {
    const files = await discoverFiles(path.join(FIXTURES_ROOT, "lcov/project"));
    const content = await fs.readFile(path.join(FIXTURES_ROOT, "lcov/report.lcov"), "utf-8");

    const { coverage, diagnostics } = parseLcov(content, files, COLLECTED_AT);

    const covered = coverage.files.find((f) => f.fileId.endsWith("covered.js"));
    expect(covered?.status).toBe("covered");
    expect(covered?.sourceTool).toBe("lcov");
    expect(covered?.branches).toEqual([{ line: 1, branchId: "0:0", taken: true }]);

    const uncovered = coverage.files.find((f) => f.fileId.endsWith("uncovered.js"));
    expect(uncovered?.status).toBe("uncovered");

    // no-report.js exists in the project but has no report entry -> "unknown" is the absence of any FileCoverage, never a synthesized entry.
    expect(coverage.files.some((f) => f.fileId.endsWith("no-report.js"))).toBe(false);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("COVERAGE_UNMAPPED_FILE");
    expect(diagnostics[0]?.filePath).toBe("src/does-not-exist.js");
  });
});

describe("parseIstanbulJson", () => {
  it("maps covered/uncovered files, leaves the unmentioned file unknown, and diagnostics the unmappable path", async () => {
    const files = await discoverFiles(path.join(FIXTURES_ROOT, "istanbul/project"));
    const content = await fs.readFile(path.join(FIXTURES_ROOT, "istanbul/coverage-final.json"), "utf-8");

    const { coverage, diagnostics } = parseIstanbulJson(content, files, COLLECTED_AT);

    const covered = coverage.files.find((f) => f.fileId.endsWith("covered.js"));
    expect(covered?.status).toBe("covered");
    expect(covered?.sourceTool).toBe("istanbul");

    const uncovered = coverage.files.find((f) => f.fileId.endsWith("uncovered.js"));
    expect(uncovered?.status).toBe("uncovered");

    expect(coverage.files.some((f) => f.fileId.endsWith("no-report.js"))).toBe(false);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("COVERAGE_UNMAPPED_FILE");
    expect(diagnostics[0]?.filePath).toBe("src/does-not-exist.js");
  });
});

describe("parseCoveragePy", () => {
  it("maps covered/uncovered files, leaves the unmentioned file unknown, and diagnostics the unmappable path", async () => {
    const files = await discoverFiles(path.join(FIXTURES_ROOT, "coverage-py/project"));
    const content = await fs.readFile(path.join(FIXTURES_ROOT, "coverage-py/coverage.json"), "utf-8");

    const { coverage, diagnostics } = parseCoveragePy(content, files, COLLECTED_AT);

    const covered = coverage.files.find((f) => f.fileId.endsWith("covered.py"));
    expect(covered?.status).toBe("covered");
    expect(covered?.sourceTool).toBe("coverage.py");

    const uncovered = coverage.files.find((f) => f.fileId.endsWith("uncovered.py"));
    expect(uncovered?.status).toBe("uncovered");

    expect(coverage.files.some((f) => f.fileId.endsWith("no-report.py"))).toBe(false);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("COVERAGE_UNMAPPED_FILE");
    expect(diagnostics[0]?.filePath).toBe("src/does-not-exist.py");
  });
});
