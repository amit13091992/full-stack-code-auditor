import { promises as fs } from "node:fs";
import path from "node:path";
import ignoreFactory from "ignore";

const ALWAYS_IGNORED = [".git", "node_modules"];

/**
 * Walks `root` depth-first, returning every file's path relative to `root` (forward-slash
 * separated). Respects `.gitignore` (read once from the repository root, per Section 1's
 * "ignore handling" requirement) plus any additional glob patterns from
 * `AnalyzerConfig.ignore.patterns`. `.git` and `node_modules` are always skipped — discovery must
 * never depend on a repository's own `.gitignore` remembering to exclude them (Section 31: treat
 * repository content as untrusted, don't rely on it being well-formed).
 */
export interface WalkOptions {
  readonly patterns?: readonly string[];
  readonly respectGitignore?: boolean;
}

export async function walkRepository(root: string, options: WalkOptions = {}): Promise<readonly string[]> {
  const { patterns = [], respectGitignore = true } = options;
  const ig = ignoreFactory();
  ig.add(ALWAYS_IGNORED);
  if (patterns.length > 0) ig.add([...patterns]);

  if (respectGitignore) {
    const gitignorePath = path.join(root, ".gitignore");
    try {
      const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
      ig.add(gitignoreContent);
    } catch {
      // No .gitignore at the repository root — nothing extra to add.
    }
  }

  const results: string[] = [];

  async function walkDir(absoluteDir: string, relativeDir: string): Promise<void> {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      // Directory-only gitignore patterns (e.g. "dist/") only match with a trailing slash.
      if (ig.ignores(entry.isDirectory() ? `${relativePath}/` : relativePath)) continue;

      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(absolutePath, relativePath);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
      // symlinks are intentionally skipped — Section 31 treats repository content as hostile
      // input, and following symlinks during discovery risks escaping the repository root.
    }
  }

  await walkDir(root, "");
  return results.sort();
}
