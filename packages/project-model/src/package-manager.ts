import { promises as fs } from "node:fs";
import path from "node:path";
import type { PackageManagerKind, WorkspacePackage } from "@code-analyzer/core";

const LOCKFILE_MANAGER: ReadonlyArray<readonly [string, PackageManagerKind]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

export interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly workspaces?: readonly string[] | { readonly packages?: readonly string[] };
}

export async function readPackageJson(dir: string): Promise<PackageJson | undefined> {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf-8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return undefined;
  }
}

export async function detectPackageManager(root: string): Promise<PackageManagerKind> {
  for (const [lockfile, kind] of LOCKFILE_MANAGER) {
    try {
      await fs.access(path.join(root, lockfile));
      return kind;
    } catch {
      // try the next lockfile
    }
  }
  const rootPackageJson = await readPackageJson(root);
  return rootPackageJson ? "npm" : "unknown";
}

/** Minimal `packages:` list extractor for a pnpm-workspace.yaml — Phase 1 doesn't need a full YAML parser. */
async function readPnpmWorkspaceGlobs(root: string): Promise<readonly string[] | undefined> {
  let content: string;
  try {
    content = await fs.readFile(path.join(root, "pnpm-workspace.yaml"), "utf-8");
  } catch {
    return undefined;
  }
  const lines = content.split(/\r?\n/);
  const globs: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue; // blank line or full-line comment — keep scanning
    const match = /^\s*-\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/.exec(line);
    if (match?.[1]) {
      globs.push(match[1].trim());
      continue;
    }
    break; // a non-blank, non-comment, non-list-item line ends the `packages:` list
  }
  return globs;
}

function workspaceGlobsFromPackageJson(pkg: PackageJson): readonly string[] | undefined {
  const workspaces = pkg.workspaces;
  if (!workspaces) return undefined;
  if (Array.isArray(workspaces)) return workspaces as readonly string[];
  return (workspaces as { readonly packages?: readonly string[] }).packages;
}

/**
 * Expands a trivial `dir/*` glob to its immediate child directories that contain a package.json;
 * an exact path resolves to itself. A pnpm/npm negation entry (e.g. `!packages/excluded`) is not
 * recognized as negation — it's treated as a literal path, resolves to no package.json, and is
 * silently filtered out below. That happens to produce the same net effect as honoring the
 * negation today, but only by coincidence; this does not implement exclusion semantics (ADR-0005).
 */
async function expandWorkspaceGlob(root: string, glob: string): Promise<readonly string[]> {
  if (!glob.endsWith("/*")) return [glob];
  const parentRelative = glob.slice(0, -2);
  const parentAbsolute = path.join(root, parentRelative);
  let entries;
  try {
    entries = await fs.readdir(parentAbsolute, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `${parentRelative}/${entry.name}`);
}

export async function detectWorkspacePackages(root: string, packageManager: PackageManagerKind): Promise<readonly WorkspacePackage[]> {
  const rootPackageJson = await readPackageJson(root);

  const pnpmGlobs = await readPnpmWorkspaceGlobs(root);
  const npmGlobs = rootPackageJson ? workspaceGlobsFromPackageJson(rootPackageJson) : undefined;
  const globs = pnpmGlobs ?? npmGlobs;

  if (!globs) {
    if (!rootPackageJson) return [];
    return [
      {
        name: rootPackageJson.name ?? path.basename(root),
        path: ".",
        manifestPath: "package.json",
        packageManager,
      },
    ];
  }

  const relativeDirs = (await Promise.all(globs.map((glob) => expandWorkspaceGlob(root, glob)))).flat();
  const packages: WorkspacePackage[] = [];
  for (const relativeDir of relativeDirs) {
    const pkg = await readPackageJson(path.join(root, relativeDir));
    if (!pkg) continue;
    packages.push({
      name: pkg.name ?? relativeDir,
      path: relativeDir,
      manifestPath: `${relativeDir}/package.json`,
      packageManager,
    });
  }
  return packages;
}
