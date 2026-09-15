import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalyzerConfig } from "../../packages/core/src/index.js";
import { noopLogger } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { parserProjectIndexer } from "../../packages/parser/src/index.js";

function configFor(root: string): AnalyzerConfig {
  return {
    root,
    profile: "standard",
    ignore: { patterns: [], respectGitignore: true },
    incremental: { enabled: false },
    sandbox: { enabled: true, networkAccess: false },
  };
}

describe("parserProjectIndexer / oversized-file DoS mitigation (security review follow-up)", () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-analyzer-parser-oversize-test-"));
  });

  afterEach(async () => {
    await fs.rm(scratchDir, { recursive: true, force: true });
  });

  it("skips a file over MAX_PARSEABLE_FILE_SIZE_BYTES instead of parsing it, and still parses normal-sized files", async () => {
    // Generated on the fly (not committed as a fixture) — a >5MB file has no place in the repo.
    const oversizedPath = path.join(scratchDir, "oversized.ts");
    const chunk = "// filler line to pad this file past the parse-size limit\n";
    const targetBytes = 5 * 1024 * 1024 + 1024; // just over MAX_PARSEABLE_FILE_SIZE_BYTES
    const repeated = chunk.repeat(Math.ceil(targetBytes / chunk.length));
    await fs.writeFile(oversizedPath, `export function big() {\n${repeated}\n  return 1;\n}\n`);

    const normalPath = path.join(scratchDir, "normal.ts");
    await fs.writeFile(normalPath, "export function small() {\n  return 1;\n}\n");

    const project = await projectModelDiscoverer.discover(scratchDir, configFor(scratchDir), noopLogger);
    const oversizedFile = project.files.find((f) => f.path === "oversized.ts");
    expect(oversizedFile).toBeDefined();
    expect(oversizedFile?.sizeBytes).toBeGreaterThan(5 * 1024 * 1024);

    const { project: indexed, diagnostics } = await parserProjectIndexer.index(project, noopLogger);

    // The oversized file produces no Module at all — it was never handed to the parser.
    const oversizedModule = indexed.modules.find((m) => m.fileId === oversizedFile?.id);
    expect(oversizedModule).toBeUndefined();

    // A normal-sized file in the same directory still parses correctly.
    const normalModule = indexed.modules.find((m) => m.id === "normal.ts");
    expect(normalModule).toBeDefined();
    expect(indexed.functions.some((f) => f.name === "small")).toBe(true);

    // ADR-0008: the skip is reported as a real Diagnostic, not just logged.
    const skipDiagnostic = diagnostics.find((d) => d.filePath === "oversized.ts");
    expect(skipDiagnostic).toMatchObject({ code: "FILE_SKIPPED_SIZE_LIMIT", severity: "info", source: "parser" });
  });

  it("surfaces a malformed file's ParseError as a real Diagnostic (ADR-0008), not just a logged one", async () => {
    const malformedPath = path.join(scratchDir, "malformed.ts");
    await fs.writeFile(malformedPath, "export function broken( {\n");

    const project = await projectModelDiscoverer.discover(scratchDir, configFor(scratchDir), noopLogger);
    const { diagnostics } = await parserProjectIndexer.index(project, noopLogger);

    expect(diagnostics.some((d) => d.filePath === "malformed.ts")).toBe(true);
  });
});
