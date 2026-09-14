import type { ClassId, FunctionId, ModuleId, SourceLocation, SymbolId } from "./ids.js";

export interface ClassProperty {
  readonly name: string;
  readonly typeText?: string;
  readonly visibility: "public" | "private" | "protected";
  readonly isStatic: boolean;
  readonly isReadonly: boolean;
  readonly decorators: readonly string[];
}

/** A class or class-like declaration (including TS interfaces treated as structural symbols elsewhere). */
export interface ClassEntity {
  readonly id: ClassId;
  readonly symbolId: SymbolId;
  readonly moduleId: ModuleId;
  readonly name: string;
  readonly isAbstract: boolean;
  readonly isExported: boolean;
  readonly extendsSymbolId?: SymbolId;
  readonly implementsSymbolIds: readonly SymbolId[];
  readonly methods: readonly FunctionId[];
  readonly properties: readonly ClassProperty[];
  readonly decorators: readonly string[];
  readonly location: SourceLocation;
}
