import type { RepositoryId } from "./ids.js";

export type VcsKind = "git" | "none";

export interface RepositoryMetadata {
  readonly id: RepositoryId;
  readonly root: string;
  readonly vcs: VcsKind;
  readonly defaultBranch?: string;
  readonly headCommit?: string;
  readonly remoteUrl?: string;
  readonly isMonorepo: boolean;
}

export type PackageManagerKind =
  | "npm"
  | "yarn"
  | "pnpm"
  | "bun"
  | "pip"
  | "poetry"
  | "cargo"
  | "go"
  | "maven"
  | "gradle"
  | "unknown";

export interface WorkspacePackage {
  readonly name: string;
  readonly path: string;
  readonly manifestPath: string;
  readonly packageManager: PackageManagerKind;
}

/** Output of Phase 1 repository discovery: what the repository is, before any parsing happens. */
export interface Repository {
  readonly metadata: RepositoryMetadata;
  readonly packages: readonly WorkspacePackage[];
}
