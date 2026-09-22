import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "../../packages/cli/src/args.js";
import { runScanCommand } from "../../packages/cli/src/commands/scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/project-model");

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-analyzer-cli-scan-test-"));
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

describe("code-analyzer scan", () => {
  it("runs real discovery end-to-end against a clean fixture with none of the built-in analyzers' issues", async () => {
    const root = path.join(FIXTURES_ROOT, "node-express");
    const outcome = await runScanCommand(parseArgs(["scan", root, "--format", "json"]));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.scan.status).toBe("completed");
    expect(outcome.result?.summary.filesAnalyzed).toBeGreaterThan(0);
    // Zero findings here reflects this fixture being clean, not analyzers being unregistered —
    // see the next test for proof the built-in analyzers actually run.
    expect(outcome.result?.findings).toHaveLength(0);
    expect(outcome.report).toBeDefined();
    expect(JSON.parse(outcome.report ?? "{}").schemaVersion).toBe("0.1.0");
  });

  it("registers the built-in analyzers and reports a real finding on a fixture with an actual issue", async () => {
    const root = path.join(__dirname, "../../fixtures/architecture/circular-import/positive");
    // --profile full: architecture/unresolved-import and quality/unused-export are asserted below
    // too, and the default "minimal" profile only runs the architecture category (ADR-0013).
    const outcome = await runScanCommand(parseArgs(["scan", root, "--format", "json", "--profile", "full"]));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.scan.analyzersRun).toEqual(
      expect.arrayContaining(["architecture/circular-import", "architecture/unresolved-import", "quality/unused-export"]),
    );
    expect(outcome.result?.findings.some((f) => f.ruleId === "architecture/circular-import")).toBe(true);
  });

  it("runs real parsing + graph construction (graphProjectIndexer, not the old passthrough stub)", async () => {
    await fs.writeFile(path.join(scratchDir, "package.json"), JSON.stringify({ name: "scan-wiring-fixture", version: "1.0.0" }));
    await fs.writeFile(path.join(scratchDir, "good.ts"), "export function ok() {\n  return 1;\n}\n");
    await fs.writeFile(path.join(scratchDir, "bad.ts"), "export function broken( {\n");

    const outcome = await runScanCommand(parseArgs(["scan", scratchDir, "--format", "json"]));

    expect(outcome.exitCode).toBe(0);
    // A real ParseError on bad.ts only reaches ScanResult.diagnostics (ADR-0008) if the real
    // parserProjectIndexer ran — the old passthrough stub always returned `diagnostics: []`.
    expect(outcome.result?.diagnostics.some((d) => d.filePath === "bad.ts")).toBe(true);
  });

  it("writes the report to --out in each supported format", async () => {
    const root = path.join(FIXTURES_ROOT, "generated-code");

    for (const format of ["json", "sarif", "html"] as const) {
      const outPath = path.join(scratchDir, `report.${format}`);
      const outcome = await runScanCommand(parseArgs(["scan", root, "--format", format, "--out", outPath]));
      expect(outcome.exitCode).toBe(0);
      const written = await fs.readFile(outPath, "utf-8");
      expect(written.length).toBeGreaterThan(0);
      if (format === "html") expect(written).toContain("<!doctype html>");
      else expect(() => JSON.parse(written)).not.toThrow();
    }
  });

  it("fails cleanly with a non-zero exit code for a missing root", async () => {
    const outcome = await runScanCommand(parseArgs(["scan", path.join(FIXTURES_ROOT, "does-not-exist")]));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.errorMessage).toMatch(/not found/i);
  });

  it("fails cleanly for an unknown --format", async () => {
    const root = path.join(FIXTURES_ROOT, "node-express");
    const outcome = await runScanCommand(parseArgs(["scan", root, "--format", "xml"]));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.errorMessage).toMatch(/Unknown --format/);
  });

  it("requires a root argument", async () => {
    const outcome = await runScanCommand(parseArgs(["scan"]));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.errorMessage).toMatch(/Usage:/);
  });
});
