import type { ClassId, FunctionId, ModuleId, SourceLocation, SymbolId } from "./ids.js";

export interface Parameter {
  readonly name: string;
  readonly typeText?: string;
  readonly optional: boolean;
  readonly defaultValueText?: string;
}

export type FunctionFlavor = "function-declaration" | "arrow" | "method" | "constructor" | "getter" | "setter";

/** A callable unit. The primary node kind consumed by the call graph and taint engine. */
export interface FunctionEntity {
  readonly id: FunctionId;
  readonly symbolId: SymbolId;
  readonly moduleId: ModuleId;
  readonly ownerClassId?: ClassId;
  readonly name: string;
  readonly flavor: FunctionFlavor;
  readonly parameters: readonly Parameter[];
  readonly returnTypeText?: string;
  readonly isAsync: boolean;
  readonly isGenerator: boolean;
  readonly isExported: boolean;
  readonly location: SourceLocation;
}
