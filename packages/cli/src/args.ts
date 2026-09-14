/**
 * Hand-rolled argument parsing (ADR-0007) — `scan`/`export` have ~5 flags each with no nested
 * subcommands, which doesn't justify a CLI-framework dependency yet.
 */

export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}

export interface ParsedArgs {
  readonly command: string | undefined;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
}

/** Parses `[command, ...args]` into a command name, positional args, and `--flag value` / `--flag=value` pairs. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === undefined) continue;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex !== -1) {
      flags[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
      continue;
    }
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new CliArgumentError(`Flag --${body} requires a value`);
    }
    flags[body] = next;
    i++;
  }

  return { command, positional, flags };
}
