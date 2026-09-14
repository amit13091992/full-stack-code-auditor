import type { DependencyId } from "./ids.js";

export type DependencyEcosystem = "npm" | "pypi" | "cargo" | "go" | "maven" | "other";

export type DependencyRelation = "direct" | "transitive" | "dev" | "peer" | "optional";

export interface DependencyVulnerability {
  readonly identifier: string;
  readonly severity: "critical" | "high" | "medium" | "low" | "info";
  readonly summary: string;
  readonly affectedRange: string;
  readonly fixedVersion?: string;
  readonly source: string;
}

/**
 * A single resolved package in the dependency graph. `used` and `reachable` are computed by
 * later phases (Section 13) and are undefined until that analysis has actually run — they must
 * never default to `false`, which would imply a claim the platform has not verified.
 */
export interface Dependency {
  readonly id: DependencyId;
  readonly name: string;
  readonly version: string;
  readonly ecosystem: DependencyEcosystem;
  readonly relation: DependencyRelation;
  readonly requestedBy: readonly DependencyId[];
  readonly vulnerabilities: readonly DependencyVulnerability[];
  readonly used?: boolean;
  readonly reachable?: boolean;
}
