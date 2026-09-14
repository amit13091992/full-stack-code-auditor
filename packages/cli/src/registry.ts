import type { Analyzer, AnalyzerCategory, AnalyzerRegistry } from "@code-analyzer/core";

/**
 * Minimal in-memory `AnalyzerRegistry` — wiring, not analysis logic (Section 32: the CLI contains
 * "no analysis logic, only... wiring to AnalyzerClient"). `@code-analyzer/analyzers` has no
 * analyzers registered yet, so `scan` runs against an empty registry today; that's expected, not a
 * bug (see docs/tasks/cli-and-reporting.md Non-goals).
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
