import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { detectPackageManager, detectWorkspacePackages } from "../../packages/project-model/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/project-model");

describe("detectPackageManager", () => {
  it("returns 'unknown' when there is no lockfile and no package.json", async () => {
    const root = path.join(FIXTURES_ROOT, "no-manifest");
    await expect(detectPackageManager(root)).resolves.toBe("unknown");
  });
});

describe("detectWorkspacePackages", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("resolves to an empty array when a pnpm workspace glob points at a nonexistent directory", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-analyzer-workspace-glob-"));
    await fs.writeFile(
      path.join(tempDir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages-that-do-not-exist/*'\n",
      "utf-8",
    );

    const packages = await detectWorkspacePackages(tempDir, "pnpm");
    expect(packages).toEqual([]);
  });
});
