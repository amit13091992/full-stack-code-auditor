import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AnalyzerConfig,
  FileId,
  Logger,
  ProjectId,
  ProjectModel,
  Repository,
  RepositoryId,
  SourceFile,
} from "@code-analyzer/core";
import type { RepositoryDiscoverer } from "@code-analyzer/core";
import { isBinary } from "./binary.js";
import { classifyLanguage, classifySource } from "./classify.js";
import { detectFrameworks } from "./frameworks.js";
import { hashContent } from "./hash.js";
import { detectPackageManager, detectWorkspacePackages, readPackageJson } from "./package-manager.js";
import { walkRepository } from "./walk.js";

async function detectVcs(root: string): Promise<{ vcs: "git" | "none"; defaultBranch?: string }> {
  const gitDir = path.join(root, ".git");
  try {
    const headContent = await fs.readFile(path.join(gitDir, "HEAD"), "utf-8");
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(headContent.trim());
    return match?.[1] ? { vcs: "git", defaultBranch: match[1] } : { vcs: "git" };
  } catch {
    return { vcs: "none" };
  }
}

async function buildSourceFile(root: string, relativePath: string): Promise<SourceFile> {
  const absolutePath = path.join(root, relativePath);
  const [stat, content] = await Promise.all([fs.stat(absolutePath), fs.readFile(absolutePath)]);
  const binary = isBinary(relativePath, content);

  return {
    id: relativePath as FileId,
    path: relativePath,
    absolutePath,
    language: binary ? "unknown" : classifyLanguage(relativePath),
    classification: classifySource(relativePath),
    sizeBytes: stat.size,
    contentHash: hashContent(content),
    encoding: binary ? "binary" : "utf-8",
  };
}

/**
 * Phase 1 `RepositoryDiscoverer` implementation (docs/tasks/phase-1-repository-discovery.md):
 * walks the filesystem, classifies every file, detects the package manager/workspace layout, and
 * detects frameworks from Section 5's initial list. Populates only `repository`, `files`, and
 * `frameworks` on the returned `ProjectModel` — every other collection is empty until Phase 2+
 * (parsing/symbol resolution) runs.
 */
export const projectModelDiscoverer: RepositoryDiscoverer = {
  async discover(root: string, config: AnalyzerConfig, logger: Logger): Promise<ProjectModel> {
    const absoluteRoot = path.resolve(root);
    logger.debug("discovering repository", { root: absoluteRoot });

    const relativePaths = await walkRepository(absoluteRoot, {
      patterns: config.ignore.patterns,
      respectGitignore: config.ignore.respectGitignore,
    });

    const files = await Promise.all(relativePaths.map((relativePath) => buildSourceFile(absoluteRoot, relativePath)));
    logger.debug("repository discovery complete", { fileCount: files.length });

    const packageManager = await detectPackageManager(absoluteRoot);
    const workspacePackages = await detectWorkspacePackages(absoluteRoot, packageManager);
    const { vcs, defaultBranch } = await detectVcs(absoluteRoot);

    const rootPackageJson = await readPackageJson(absoluteRoot);
    const workspacePackageJsons = await Promise.all(
      workspacePackages
        .filter((pkg) => pkg.path !== ".")
        .map((pkg) => readPackageJson(path.join(absoluteRoot, pkg.path))),
    );
    const allPackageJsons = [rootPackageJson, ...workspacePackageJsons].filter((pkg): pkg is NonNullable<typeof pkg> => pkg !== undefined);
    const frameworks = detectFrameworks(allPackageJsons);

    const repositoryId = absoluteRoot as RepositoryId;
    const repository: Repository = {
      metadata: {
        id: repositoryId,
        root: absoluteRoot,
        vcs,
        isMonorepo: workspacePackages.length > 1,
        ...(defaultBranch ? { defaultBranch } : {}),
      },
      packages: workspacePackages,
    };

    return {
      id: absoluteRoot as ProjectId,
      repository,
      frameworks,
      files,
      modules: [],
      symbols: [],
      functions: [],
      classes: [],
      dependencies: [],
      endpoints: [],
      databaseEntities: [],
      services: [],
      securityBoundaries: [],
    };
  },
};
