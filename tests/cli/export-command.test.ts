import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "../../packages/cli/src/args.js";
import { runExportCommand } from "../../packages/cli/src/commands/export.js";
import { runScanCommand } from "../../packages/cli/src/commands/scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/project-model");

let scratchDir: string;
let resultJsonPath: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-analyzer-cli-export-test-"));
  resultJsonPath = path.join(scratchDir, "scan-result.json");
  const scanOutcome = await runScanCommand(
    parseArgs(["scan", path.join(FIXTURES_ROOT, "node-express"), "--format", "json", "--out", resultJsonPath]),
  );
  expect(scanOutcome.exitCode).toBe(0);
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

describe("code-analyzer export", () => {
  it("re-exports a previously produced ScanResult into sarif and html without re-scanning", async () => {
    const sarifOutcome = await runExportCommand(parseArgs(["export", "--format", "sarif", "--in", resultJsonPath]));
    expect(sarifOutcome.exitCode).toBe(0);
    expect(JSON.parse(sarifOutcome.report ?? "{}").version).toBe("2.1.0");

    const htmlOutcome = await runExportCommand(parseArgs(["export", "--format", "html", "--in", resultJsonPath]));
    expect(htmlOutcome.exitCode).toBe(0);
    expect(htmlOutcome.report).toContain("<!doctype html>");
  });

  it("writes to --out when given", async () => {
    const outPath = path.join(scratchDir, "reexported.html");
    const outcome = await runExportCommand(parseArgs(["export", "--format", "html", "--in", resultJsonPath, "--out", outPath]));
    expect(outcome.exitCode).toBe(0);
    const written = await fs.readFile(outPath, "utf-8");
    expect(written).toContain("<!doctype html>");
  });

  it("fails cleanly when --format is missing", async () => {
    const outcome = await runExportCommand(parseArgs(["export", "--in", resultJsonPath]));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.errorMessage).toMatch(/--format/);
  });

  it("fails cleanly when --in points at a non-existent file", async () => {
    const outcome = await runExportCommand(parseArgs(["export", "--format", "json", "--in", path.join(scratchDir, "missing.json")]));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.errorMessage).toMatch(/Failed to read\/parse/);
  });
});
