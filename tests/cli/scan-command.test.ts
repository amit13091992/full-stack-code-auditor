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
  it("runs real discovery end-to-end and reports zero findings (no analyzers registered yet)", async () => {
    const root = path.join(FIXTURES_ROOT, "node-express");
    const outcome = await runScanCommand(parseArgs(["scan", root, "--format", "json"]));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.scan.status).toBe("completed");
    expect(outcome.result?.summary.filesAnalyzed).toBeGreaterThan(0);
    expect(outcome.result?.findings).toHaveLength(0);
    expect(outcome.report).toBeDefined();
    expect(JSON.parse(outcome.report ?? "{}").schemaVersion).toBe("0.1.0");
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
