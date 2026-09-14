import { describe, expect, it } from "vitest";
import { CliArgumentError, parseArgs } from "../../packages/cli/src/args.js";

describe("parseArgs", () => {
  it("parses a command, positional args, and --flag value pairs", () => {
    const args = parseArgs(["scan", "./repo", "--format", "sarif", "--out", "report.sarif"]);
    expect(args.command).toBe("scan");
    expect(args.positional).toEqual(["./repo"]);
    expect(args.flags).toEqual({ format: "sarif", out: "report.sarif" });
  });

  it("parses --flag=value syntax", () => {
    const args = parseArgs(["export", "--format=json", "--in=result.json"]);
    expect(args.flags).toEqual({ format: "json", in: "result.json" });
  });

  it("throws CliArgumentError when a flag is missing its value", () => {
    expect(() => parseArgs(["scan", "./repo", "--format"])).toThrow(CliArgumentError);
  });

  it("handles no command at all", () => {
    const args = parseArgs([]);
    expect(args.command).toBeUndefined();
    expect(args.positional).toEqual([]);
  });
});
