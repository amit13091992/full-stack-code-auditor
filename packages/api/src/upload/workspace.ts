import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ScanWorkspace {
  readonly root: string;
  cleanup(): Promise<void>;
}

const WORKSPACE_PREFIX = "codegraph-api-";

/** One isolated temp directory per request; never reused or shared across concurrent requests. */
export async function createTempWorkspace(): Promise<ScanWorkspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), WORKSPACE_PREFIX));
  let cleaned = false;
  return {
    root,
    async cleanup(): Promise<void> {
      if (cleaned) return;
      cleaned = true;
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * Startup safety net: removes any workspace directories left behind by a crashed/killed previous
 * process. Only ever touches directories under the prefix this module creates.
 */
export async function sweepOrphanedWorkspaces(olderThanMs: number): Promise<void> {
  const tmp = os.tmpdir();
  let entries: string[];
  try {
    entries = await fs.readdir(tmp);
  } catch {
    return;
  }

  const cutoff = Date.now() - olderThanMs;
  for (const entry of entries) {
    if (!entry.startsWith(WORKSPACE_PREFIX)) continue;
    const fullPath = path.join(tmp, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(fullPath, { recursive: true, force: true });
      }
    } catch {
      // Already gone, or a permissions issue outside our control — not fatal to the sweep.
    }
  }
}
