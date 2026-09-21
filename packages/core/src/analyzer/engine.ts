import { randomUUID } from "node:crypto";
import type { AnalyzerConfig, ScanOptions } from "../config/scan-options.js";
import { ScanCancelledError } from "../errors/errors.js";
import type { Diagnostic } from "../errors/errors.js";
import type { Evidence } from "../domain/evidence.js";
import type { Finding } from "../domain/finding.js";
import type { ScanId } from "../domain/ids.js";
import type { ScanEvent, ScanEventEmitter, ScanEventListener } from "../events/events.js";
import type { Logger } from "../logging/logger.js";
import { noopLogger } from "../logging/logger.js";
import type { ScanResult, ScanSummary } from "../serialization/scan-result.js";
import { SCAN_RESULT_SCHEMA_VERSION } from "../serialization/scan-result.js";
import type { Analyzer, AnalyzerRegistry } from "./analyzer.js";
import type { AnalyzerContext } from "./context.js";
import type { PipelineStrategies } from "./pipeline.js";

class SimpleEventEmitter implements ScanEventEmitter {
  private readonly listeners = new Set<ScanEventListener>();

  on(listener: ScanEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: ScanEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function summarize(findings: readonly Finding[], analyzersRun: readonly string[], filesAnalyzed: number): ScanSummary {
  const findingsBySeverity: Record<string, number> = {};
  const findingsByCategory: Record<string, number> = {};
  for (const finding of findings) {
    findingsBySeverity[finding.severity] = (findingsBySeverity[finding.severity] ?? 0) + 1;
    findingsByCategory[finding.category] = (findingsByCategory[finding.category] ?? 0) + 1;
  }
  return {
    totalFindings: findings.length,
    findingsBySeverity,
    findingsByCategory,
    filesAnalyzed,
    analyzersRun,
  };
}

/**
 * Orchestrates the lifecycle every scan follows (Section 3 pipeline, Section 37D):
 * initialize -> discover -> parse/index -> analyze -> correlate -> finalize.
 *
 * This class contains zero analysis logic itself. It exists so the CLI, CI integration, and any
 * future IDE extension share one implementation of "how a scan runs" instead of each
 * re-implementing stage ordering, cancellation, and event emission.
 */
export class ScanEngine {
  private readonly registry: AnalyzerRegistry;
  private readonly strategies: PipelineStrategies;
  private readonly config: AnalyzerConfig;
  private readonly logger: Logger;

  constructor(params: {
    registry: AnalyzerRegistry;
    strategies: PipelineStrategies;
    config: AnalyzerConfig;
    logger?: Logger;
  }) {
    this.registry = params.registry;
    this.strategies = params.strategies;
    this.config = params.config;
    this.logger = params.logger ?? noopLogger;
  }

  async scan(options: ScanOptions = {}): Promise<ScanResult> {
    const scanId = randomUUID() as ScanId;
    const events = new SimpleEventEmitter();
    if (options.onEvent) events.on(options.onEvent);
    const controller = new AbortController();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener("abort", () => controller.abort());
    const signal = controller.signal;
    const startedAt = new Date();

    const profile = options.profile ?? this.config.profile;
    events.emit({ type: "scan:started", scanId, profile });

    const diagnostics: Diagnostic[] = [];
    const allFindings: Finding[] = [];
    const allEvidence: Evidence[] = [];
    const analyzersRun: string[] = [];

    try {
      this.checkCancelled(signal);
      events.emit({ type: "stage:started", scanId, stage: "discover" });
      const discovered = await this.strategies.discoverer.discover(this.config.root, this.config, this.logger);
      events.emit({ type: "stage:completed", scanId, stage: "discover", durationMs: 0 });

      this.checkCancelled(signal);
      events.emit({ type: "stage:started", scanId, stage: "index" });
      const {
        project,
        graphs,
        diagnostics: indexDiagnostics,
      } = await this.strategies.indexer.index(discovered, this.logger);
      diagnostics.push(...indexDiagnostics);
      events.emit({ type: "stage:completed", scanId, stage: "index", durationMs: 0 });

      this.checkCancelled(signal);
      events.emit({ type: "stage:started", scanId, stage: "analyze" });
      const selectedIds = options.analyzers ?? this.config.analyzers;
      const analyzers: readonly Analyzer[] = selectedIds
        ? selectedIds.map((id) => this.registry.get(id)).filter((a): a is Analyzer => a !== undefined)
        : this.registry.list();

      const context: AnalyzerContext = {
        scanId,
        project,
        frameworks: project.frameworks,
        graphs,
        config: this.config,
        logger: this.logger,
        events,
        signal,
        ...(options.changedFiles ? { changedFiles: options.changedFiles } : {}),
        ...(options.coverage ? { coverage: options.coverage } : {}),
      };

      for (const analyzer of analyzers) {
        this.checkCancelled(signal);
        if (!analyzer.supports(context)) continue;
        events.emit({ type: "analyzer:started", scanId, analyzerId: analyzer.id });
        const t0 = Date.now();
        const result = await analyzer.analyze(context);
        const durationMs = Date.now() - t0;
        analyzersRun.push(analyzer.id);
        allFindings.push(...result.findings);
        allEvidence.push(...result.evidence);
        diagnostics.push(...result.diagnostics);
        for (const finding of result.findings) {
          events.emit({ type: "finding:emitted", scanId, finding });
        }
        events.emit({ type: "analyzer:completed", scanId, analyzerId: analyzer.id, durationMs, findingCount: result.findings.length });
      }
      events.emit({ type: "stage:completed", scanId, stage: "analyze", durationMs: 0 });

      this.checkCancelled(signal);
      events.emit({ type: "stage:started", scanId, stage: "correlate" });
      const correlated = this.strategies.correlator
        ? await this.strategies.correlator.correlate(allFindings)
        : allFindings;
      const scored = this.strategies.riskCalculator
        ? await this.strategies.riskCalculator.score(correlated)
        : correlated;
      events.emit({ type: "stage:completed", scanId, stage: "correlate", durationMs: 0 });

      events.emit({ type: "stage:started", scanId, stage: "finalize" });
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      const result: ScanResult = {
        schemaVersion: SCAN_RESULT_SCHEMA_VERSION,
        scan: {
          id: scanId,
          projectId: project.id,
          profile,
          mode: options.mode ?? "full",
          status: "completed",
          analyzersRun,
          findingIds: scored.map((f) => f.id),
          timing: { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs },
          ...(options.baseCommit ? { baseCommit: options.baseCommit } : {}),
          ...(options.headCommit ? { headCommit: options.headCommit } : {}),
        },
        findings: scored,
        evidence: allEvidence,
        diagnostics,
        summary: summarize(scored, analyzersRun, project.files.length),
      };
      events.emit({ type: "stage:completed", scanId, stage: "finalize", durationMs: 0 });
      events.emit({ type: "scan:completed", scanId, durationMs });
      return result;
    } catch (error) {
      if (error instanceof ScanCancelledError) {
        events.emit({ type: "scan:cancelled", scanId });
      } else {
        events.emit({ type: "scan:failed", scanId, reason: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  private checkCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw new ScanCancelledError();
  }
}
