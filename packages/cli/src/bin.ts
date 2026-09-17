#!/usr/bin/env node
import { parseArgs, CliArgumentError } from "./args.js";
import { runExportCommand } from "./commands/export.js";
import { runScanCommand } from "./commands/scan.js";

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliArgumentError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  switch (args.command) {
    case "scan": {
      const outcome = await runScanCommand(args);
      if (outcome.exitCode !== 0) {
        process.stderr.write(`${outcome.errorMessage}\n`);
        return outcome.exitCode;
      }
      if (outcome.result) {
        process.stderr.write(
          `scan complete: ${outcome.result.summary.totalFindings} finding(s) across ${outcome.result.summary.filesAnalyzed} file(s)\n`,
        );
      }
      if (!args.flags.out && outcome.report) {
        process.stdout.write(`${outcome.report}\n`);
      }
      return 0;
    }
    case "export": {
      const outcome = await runExportCommand(args);
      if (outcome.exitCode !== 0) {
        process.stderr.write(`${outcome.errorMessage}\n`);
        return outcome.exitCode;
      }
      if (!args.flags.out && outcome.report) {
        process.stdout.write(`${outcome.report}\n`);
      }
      return 0;
    }
    default: {
      process.stderr.write("Usage: codegraph-scan <scan|export> [...flags]\n");
      return 1;
    }
  }
}

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
