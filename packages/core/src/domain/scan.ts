import type { FindingId, ScanId } from "./ids.js";

export type ScanProfile = "minimal" | "standard" | "security" | "full" | "enterprise";

export type ScanMode = "full" | "incremental" | "changed-files";

export type ScanStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface ScanTiming {
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
}

/** The record of one execution of the analyzer over a project (Section 37). */
export interface Scan {
  readonly id: ScanId;
  readonly projectId: string;
  readonly profile: ScanProfile;
  readonly mode: ScanMode;
  readonly status: ScanStatus;
  readonly analyzersRun: readonly string[];
  readonly findingIds: readonly FindingId[];
  readonly timing: ScanTiming;
  readonly baseCommit?: string;
  readonly headCommit?: string;
}
