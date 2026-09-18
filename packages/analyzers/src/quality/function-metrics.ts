import type { AnalyzerContext, FunctionEntity } from "@code-analyzer/core";

/**
 * `ProjectModel` retains no source text and `FunctionEntity` carries no branch/AST data (checked
 * `packages/core/src/domain/function.ts`, `packages/parser/src/parse-file.ts` before writing this) —
 * so a true McCabe cyclomatic complexity (counting `if`/`for`/`while`/`case`/`&&`/`||`/`?:` branches)
 * is not computable from Phase 2/3 data without either the analyzer parsing the AST itself
 * (disallowed — analyzers read `context.project`/`context.graphs` only) or a core contract change
 * (out of scope for this package; flagged separately, not made here). This computes a documented
 * proxy instead: `1 + nestedFunctionCount + floor(lineSpan / 10)`. Nested function/arrow/method
 * declarations are a real, derivable proxy for branching logic (callbacks passed to conditionals,
 * `.map`/`.filter` chains, event handlers) since `FunctionEntity.location.range` already gives exact
 * lexical containment; line span approximates the remaining straight-line + branch complexity that
 * can't be counted directly. This is named/labeled "complexity score", never "cyclomatic complexity",
 * in any Finding/Evidence text, to avoid overclaiming precision the data doesn't support (ADR-0004).
 */
export interface FunctionMetrics {
  readonly fn: FunctionEntity;
  readonly lineSpan: number;
  readonly nestedFunctionCount: number;
  readonly complexityScore: number;
}

function lineSpanOf(fn: FunctionEntity): number {
  const range = fn.location.range;
  if (!range) return 1;
  return range.end.line - range.start.line + 1;
}

function isNestedWithin(inner: FunctionEntity, outer: FunctionEntity): boolean {
  if (inner === outer) return false;
  if (inner.moduleId !== outer.moduleId) return false;
  const innerRange = inner.location.range;
  const outerRange = outer.location.range;
  if (!innerRange || !outerRange) return false;
  return innerRange.start.offset > outerRange.start.offset && innerRange.end.offset < outerRange.end.offset;
}

/** Direct nesting only (not transitively-nested grandchildren), to avoid double-counting depth. */
function directNestedFunctions(fn: FunctionEntity, allInModule: readonly FunctionEntity[]): FunctionEntity[] {
  const containedIn = allInModule.filter((candidate) => isNestedWithin(candidate, fn));
  return containedIn.filter((candidate) => !containedIn.some((other) => other !== candidate && isNestedWithin(candidate, other)));
}

export function computeFunctionMetrics(project: AnalyzerContext["project"]): FunctionMetrics[] {
  const byModule = new Map<string, FunctionEntity[]>();
  for (const fn of project.functions) {
    const key = fn.moduleId as string;
    const existing = byModule.get(key);
    if (existing) existing.push(fn);
    else byModule.set(key, [fn]);
  }

  const results: FunctionMetrics[] = [];
  for (const fn of project.functions) {
    const siblings = byModule.get(fn.moduleId as string) ?? [];
    const nestedFunctionCount = directNestedFunctions(fn, siblings).length;
    const lineSpan = lineSpanOf(fn);
    const complexityScore = 1 + nestedFunctionCount + Math.floor(lineSpan / 10);
    results.push({ fn, lineSpan, nestedFunctionCount, complexityScore });
  }
  return results;
}
