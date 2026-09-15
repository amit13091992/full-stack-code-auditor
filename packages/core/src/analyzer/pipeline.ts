import type { AnalyzerConfig, ScanOptions } from "../config/scan-options.js";
import type { ProjectModel } from "../domain/project.js";
import type { GraphAccess } from "./context.js";
import type { Finding } from "../domain/finding.js";
import type { Logger } from "../logging/logger.js";
import type { Diagnostic } from "../errors/errors.js";

/**
 * Pipeline stage strategies (Section 2/37D). Core defines and orchestrates these interfaces but
 * ships no implementation beyond a trivial default — real discovery/parsing/indexing/correlation
 * is Phase 1+ work in `@code-analyzer/project-model`, `@code-analyzer/parser`, and
 * `@code-analyzer/graph`. This split is what lets the CLI, CI action, and IDE extension all reuse
 * one pipeline instead of re-implementing analysis.
 */

export interface RepositoryDiscoverer {
  discover(root: string, config: AnalyzerConfig, logger: Logger): Promise<ProjectModel>;
}

export interface ProjectIndexer {
  /** Parses + resolves symbols and builds the graphs for a discovered project. */
  index(
    project: ProjectModel,
    logger: Logger,
  ): Promise<{ project: ProjectModel; graphs: GraphAccess; diagnostics: readonly Diagnostic[] }>;
}

export interface FindingCorrelator {
  correlate(findings: readonly Finding[]): Promise<readonly Finding[]>;
}

export interface RiskCalculator {
  score(findings: readonly Finding[]): Promise<readonly Finding[]>;
}

/** The set of strategies a ScanEngine needs; a profile may omit correlation/risk for `minimal` scans. */
export interface PipelineStrategies {
  readonly discoverer: RepositoryDiscoverer;
  readonly indexer: ProjectIndexer;
  readonly correlator?: FindingCorrelator;
  readonly riskCalculator?: RiskCalculator;
}

export type { ScanOptions };
