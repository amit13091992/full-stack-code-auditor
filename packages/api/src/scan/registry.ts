import type { Analyzer, AnalyzerCategory, AnalyzerRegistry } from "@code-analyzer/core";

/**
 * Minimal in-memory `AnalyzerRegistry`, same shape as `@code-analyzer/cli`'s — this package
 * mirrors the CLI's wiring rather than depending on `@code-analyzer/cli` (which is not part of the
 * public dependency graph any other package reaches into, per ADR-0001).
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
