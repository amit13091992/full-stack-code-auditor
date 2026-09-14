import type { ClassId, FunctionId, ModuleId, SymbolId, SymbolKind } from "@code-analyzer/core";

/**
 * Deterministic ID generation (ADR-0006): derived from `(modulePath, kind, name, declaration
 * start offset)`, never a random UUID, so re-parsing unchanged content yields identical IDs.
 */

export function toModuleId(path: string): ModuleId {
  return path as ModuleId;
}

export function toSymbolId(path: string, kind: SymbolKind, name: string, offset: number): SymbolId {
  return `${path}#${kind}:${name}@${offset}` as SymbolId;
}

export function toFunctionId(path: string, name: string, offset: number): FunctionId {
  return `${path}#function:${name}@${offset}` as FunctionId;
}

export function toClassId(path: string, name: string, offset: number): ClassId {
  return `${path}#class:${name}@${offset}` as ClassId;
}
