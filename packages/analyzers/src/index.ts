/**
 * @code-analyzer/analyzers — Section 7/17/18 rule implementations.
 *
 * First real content (docs/tasks/first-graph-analyzers.md): three Module-Graph-only analyzers,
 * plus a regex-based secrets scanner (the first "secrets" category rule — see
 * packages/analyzers/src/secrets/secrets-analyzer.ts for its documented file-I/O exception).
 * Consumers register them against their own `AnalyzerRegistry` — this package never wires an
 * analyzer directly into `packages/cli` or any other consumer (see the analyzer-development skill).
 */
import type { AnalyzerRegistry } from "@code-analyzer/core";
import { circularImportAnalyzer } from "./circular-import.js";
import { unresolvedImportAnalyzer } from "./unresolved-import.js";
import { unusedExportAnalyzer } from "./unused-export.js";
import { secretsAnalyzer } from "./secrets/secrets-analyzer.js";
import { cyclomaticComplexityAnalyzer } from "./quality/cyclomatic-complexity.js";
import { duplicationAnalyzer } from "./quality/duplication.js";
import { maintainabilityIndexAnalyzer } from "./quality/maintainability-index.js";
import { lintStyleRulesAnalyzer } from "./quality/lint-style-rules.js";
import { sqlInjectionAnalyzer } from "./security/sql-injection.js";

export { circularImportAnalyzer } from "./circular-import.js";
export { unresolvedImportAnalyzer } from "./unresolved-import.js";
export { unusedExportAnalyzer } from "./unused-export.js";
export { secretsAnalyzer } from "./secrets/secrets-analyzer.js";
export { cyclomaticComplexityAnalyzer } from "./quality/cyclomatic-complexity.js";
export { duplicationAnalyzer } from "./quality/duplication.js";
export { maintainabilityIndexAnalyzer } from "./quality/maintainability-index.js";
export { lintStyleRulesAnalyzer } from "./quality/lint-style-rules.js";
export { sqlInjectionAnalyzer } from "./security/sql-injection.js";

/** All analyzers this package currently ships, in a stable order. */
export function builtinAnalyzers() {
  return [
    circularImportAnalyzer,
    unresolvedImportAnalyzer,
    unusedExportAnalyzer,
    secretsAnalyzer,
    cyclomaticComplexityAnalyzer,
    duplicationAnalyzer,
    maintainabilityIndexAnalyzer,
    lintStyleRulesAnalyzer,
    sqlInjectionAnalyzer,
  ] as const;
}

/** Registers every built-in analyzer against the given registry. Never called from `packages/cli` directly. */
export function registerBuiltinAnalyzers(registry: AnalyzerRegistry): void {
  for (const analyzer of builtinAnalyzers()) {
    registry.register(analyzer);
  }
}
