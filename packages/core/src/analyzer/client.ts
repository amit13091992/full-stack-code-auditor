import type { AnalyzerConfig, ScanOptions } from "../config/scan-options.js";
import type { ScanResult } from "../serialization/scan-result.js";
import type { AnalyzerRegistry } from "./analyzer.js";
import { ScanEngine } from "./engine.js";
import type { PipelineStrategies } from "./pipeline.js";
import type { Logger } from "../logging/logger.js";

/**
 * The public facade end users instantiate (Section 3: `new Analyzer({ root, profile })`).
 *
 * Naming note (see ADR-0002): Section 37C also asks for an interface literally named `Analyzer`
 * for the per-rule contract implemented by every analysis engine (see ./analyzer.ts). Those are
 * two distinct concepts — a facade class vs. a rule contract — that happen to share a name in the
 * prompt text. We keep the interface named `Analyzer` because Section 37C is explicit about that
 * name, and name this facade `AnalyzerClient`. The CLI package re-exports `AnalyzerClient as Analyzer`
 * at its own boundary so the documented `new Analyzer(...)` usage still works for consumers who
 * only ever import the facade and never need the rule contract in the same scope.
 */
export class AnalyzerClient {
  private readonly engine: ScanEngine;

  constructor(params: { config: AnalyzerConfig; registry: AnalyzerRegistry; strategies: PipelineStrategies; logger?: Logger }) {
    this.engine = new ScanEngine(
      params.logger
        ? { registry: params.registry, strategies: params.strategies, config: params.config, logger: params.logger }
        : { registry: params.registry, strategies: params.strategies, config: params.config },
    );
  }

  async scan(options?: ScanOptions): Promise<ScanResult> {
    return this.engine.scan(options);
  }
}
