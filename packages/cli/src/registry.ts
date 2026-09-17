import type { Analyzer, AnalyzerCategory, AnalyzerRegistry } from "@code-analyzer/core";

/**
 * Minimal in-memory `AnalyzerRegistry` — wiring, not analysis logic (Section 32: the CLI contains
 * "no analysis logic, only... wiring to AnalyzerClient"). `scan.ts` populates an instance of this
 * with `@code-analyzer/analyzers`' built-in rules via `registerBuiltinAnalyzers`.
 */
export class InMemoryAnalyzerRegistry implements AnalyzerRegistry {
  private readonly analyzers = new Map<string, Analyzer>();

  register(analyzer: Analyzer): void {
    this.analyzers.set(analyzer.id, analyzer);
  }

  get(id: string): Analyzer | undefined {
    return this.analyzers.get(id);
  }

  list(): readonly Analyzer[] {
    return [...this.analyzers.values()];
  }

  listByCategory(category: AnalyzerCategory): readonly Analyzer[] {
    return this.list().filter((analyzer) => analyzer.capabilities.category === category);
  }
}
