import type { AnalyzerConfig } from "../config/scan-options.js";
import type { FrameworkId, ProjectModel } from "../domain/project.js";
import type { ScanId } from "../domain/ids.js";
import type { Graph } from "../graph/graph.js";
import type { Logger } from "../logging/logger.js";
import type { ScanEventEmitter } from "../events/events.js";

/**
 * Read-only view of graphs an analyzer may query. Individual graphs are optional because not
 * every phase's graph exists yet in every profile (e.g. `security` profile may skip the full
 * taint graph rebuild during an incremental scan).
 */
export interface GraphAccess {
  readonly moduleGraph?: Graph;
  readonly dependencyGraph?: Graph;
  readonly symbolGraph?: Graph;
  readonly callGraph?: Graph;
  readonly taintGraph?: Graph;
  readonly applicationGraph?: Graph;
}

/**
 * Everything an Analyzer implementation is handed at analyze-time (Section 37C). Analyzers must
 * treat `project` and the graphs as read-only — mutation happens only through the finding/evidence
 * emission methods, never by writing back into the model.
 */
export interface AnalyzerContext {
  readonly scanId: ScanId;
  readonly project: ProjectModel;
  readonly frameworks: readonly FrameworkId[];
  readonly graphs: GraphAccess;
  readonly config: AnalyzerConfig;
  readonly logger: Logger;
  readonly events: ScanEventEmitter;
  readonly signal: AbortSignal;
  /** Files touched since `baseCommit`, populated only for incremental/changed-files scans. */
  readonly changedFiles?: readonly string[];
}
