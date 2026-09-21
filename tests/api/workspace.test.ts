import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTempWorkspace } from "../../packages/api/src/upload/workspace.js";

describe("createTempWorkspace", () => {
  it("creates an isolated directory and cleans it up", async () => {
    const workspace = await createTempWorkspace();
    const stat = await fs.stat(workspace.root);
    expect(stat.isDirectory()).toBe(true);

    await workspace.cleanup();
    await expect(fs.access(workspace.root)).rejects.toThrow();
  });

  it("returns distinct roots for concurrent workspaces", async () => {
    const [a, b] = await Promise.all([createTempWorkspace(), createTempWorkspace()]);
    expect(a.root).not.toBe(b.root);
    await Promise.all([a.cleanup(), b.cleanup()]);
  });

  it("cleanup is idempotent and safe to call more than once", async () => {
    const workspace = await createTempWorkspace();
    await workspace.cleanup();
    await expect(workspace.cleanup()).resolves.toBeUndefined();
  });
});
