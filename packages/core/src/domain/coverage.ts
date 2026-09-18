import type { FileId } from "./ids.js";

/**
 * `"unknown"` means the coverage report has no entry for this file at all (ADR-0004/ADR-0010) —
 * it must never be conflated with `"uncovered"`, which means the tool ran over the file and
 * recorded zero hits. Ingestion code (`packages/integrations/src/coverage/*`) is the only place
 * that decides between these two; nothing downstream may re-derive "unknown" from an empty
 * `lines`/`branches` array on an entry that does exist.
 */
export type CoverageStatus = "covered" | "uncovered" | "partially-covered" | "unknown";

export interface LineCoverage {
  readonly line: number;
  /** 0 means executed-zero-times; absence of a line's entry in `FileCoverage.lines` means no data for that line. */
  readonly hits: number;
}

export interface BranchCoverage {
  readonly line: number;
  readonly branchId: string;
  readonly taken: boolean;
}

export interface FileCoverage {
  readonly fileId: FileId;
  readonly status: CoverageStatus;
  readonly lines: readonly LineCoverage[];
  readonly branches: readonly BranchCoverage[];
  /** e.g. "lcov", "istanbul", "coverage.py". */
  readonly sourceTool: string;
  /** ISO timestamp of when the report was produced, not scan time. */
  readonly collectedAt: string;
}

/**
 * A file present in `ProjectModel.files` with no matching entry in `files` is `"unknown"`
 * coverage, not `"uncovered"` — ingestion must never synthesize a `FileCoverage` entry for a file
 * the report simply didn't mention (ADR-0004, ADR-0010 Decision §3).
 */
export interface CoverageModel {
  readonly files: readonly FileCoverage[];
}
