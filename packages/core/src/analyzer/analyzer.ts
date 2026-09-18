import type { FrameworkId } from "../domain/project.js";
import type { AnalysisResult } from "./result.js";
import type { AnalyzerContext } from "./context.js";

export type AnalyzerCategory =
  | "security"
  | "architecture"
  | "quality"
  | "performance"
  | "dependency"
  | "secrets"
  | "infrastructure";

export interface AnalyzerCapabilities {
  readonly category: AnalyzerCategory;
  /** Frameworks this analyzer is meaningful for. Empty = framework-agnostic. */
  readonly frameworks?: readonly FrameworkId[];
  readonly requiresGraphs?: readonly (keyof AnalyzerContext["graphs"])[];
}

/**
 * The contract every analysis engine and rule ultimately implements (Section 37C, Section 7).
 * An Analyzer is a pure function of AnalyzerContext -> AnalysisResult: it must not mutate the
 * ProjectModel or graphs it is given, and it must not perform its own file I/O or AST parsing —
 * both are already normalized into `context.project` before `analyze()` runs.
 *
 * One narrow, named exception exists for pattern-scanning analyzers with no AST/graph
 * representation of what they match (e.g. secrets detection) — see ADR-0011
 * (docs/decisions/ADR-0011-analyzer-raw-text-read-exception.md) and
 * packages/analyzers/src/shared/read-source-text-safely.ts, the one sanctioned utility for it.
 * This is opt-in per analyzer, not a general capability — most analyzers should never need it.
 */
export interface Analyzer {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: AnalyzerCapabilities;

  /** Cheap check run before `analyze()` — e.g. skip a NestJS-specific analyzer on a plain Express repo. */
  supports(context: AnalyzerContext): boolean;

  analyze(context: AnalyzerContext): Promise<AnalysisResult>;
}

/** Registry of available analyzers, queried by the scan engine to build a run plan for a profile. */
export interface AnalyzerRegistry {
  register(analyzer: Analyzer): void;
  get(id: string): Analyzer | undefined;
  list(): readonly Analyzer[];
  listByCategory(category: AnalyzerCategory): readonly Analyzer[];
}
