/**
 * @code-analyzer/analyzers — Section 7/17/18 rule implementations.
 *
 * First real content (docs/tasks/first-graph-analyzers.md): three Module-Graph-only analyzers.
 * Consumers register them against their own `AnalyzerRegistry` — this package never wires an
 * analyzer directly into `packages/cli` or any other consumer (see the analyzer-development skill).
 */
import type { AnalyzerRegistry } from "@code-analyzer/core";
import { circularImportAnalyzer } from "./circular-import.js";
import { unresolvedImportAnalyzer } from "./unresolved-import.js";
import { unusedExportAnalyzer } from "./unused-export.js";

export { circularImportAnalyzer } from "./circular-import.js";
export { unresolvedImportAnalyzer } from "./unresolved-import.js";
export { unusedExportAnalyzer } from "./unused-export.js";

/** All analyzers this package currently ships, in a stable order. */
export function builtinAnalyzers() {
  return [circularImportAnalyzer, unresolvedImportAnalyzer, unusedExportAnalyzer] as const;
}

/** Registers every built-in analyzer against the given registry. Never called from `packages/cli` directly. */
export function registerBuiltinAnalyzers(registry: AnalyzerRegistry): void {
  for (const analyzer of builtinAnalyzers()) {
    registry.register(analyzer);
  }
}
