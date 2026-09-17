import { promises as fs } from "node:fs";
import path from "node:path";
import type { ScanResult } from "@code-analyzer/core";
import type { ParsedArgs } from "../args.js";
import { getExporter, type ExportFormat } from "../exporters/index.js";

const VALID_FORMATS: readonly ExportFormat[] = ["json", "sarif", "html"];

export interface ExportCommandResult {
  readonly exitCode: number;
  readonly report?: string;
  readonly errorMessage?: string;
}

/**
 * `codegraph-scan export --format <fmt> --in <scan-result.json> --out <path>`
 * (docs/tasks/cli-and-reporting.md) — re-exports an already-produced `ScanResult` into a different
 * format without re-running discovery/analysis.
 */
export async function runExportCommand(args: ParsedArgs): Promise<ExportCommandResult> {
  const format = args.flags.format as ExportFormat | undefined;
  if (!format || !VALID_FORMATS.includes(format)) {
    return { exitCode: 1, errorMessage: `--format is required and must be one of: ${VALID_FORMATS.join(", ")}` };
  }

  const inPath = args.flags.in;
  if (!inPath) {
    return { exitCode: 1, errorMessage: "--in <scan-result.json> is required" };
  }

  let result: ScanResult;
  try {
    const raw = await fs.readFile(path.resolve(inPath), "utf-8");
    result = JSON.parse(raw) as ScanResult;
  } catch (error) {
    return { exitCode: 1, errorMessage: `Failed to read/parse --in "${inPath}": ${error instanceof Error ? error.message : String(error)}` };
  }

  const report = getExporter(format).export(result);

  const outPath = args.flags.out;
  if (outPath) {
    await fs.writeFile(path.resolve(outPath), report, "utf-8");
  }

  return { exitCode: 0, report };
}
