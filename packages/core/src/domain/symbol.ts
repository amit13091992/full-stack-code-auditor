import type { FileId, ModuleId, SourceLocation, SymbolId } from "./ids.js";

export type SymbolKind =
  | "variable"
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type-alias"
  | "enum"
  | "parameter"
  | "property"
  | "import-binding"
  | "export-binding"
  | "unknown";

export type Visibility = "public" | "private" | "protected" | "internal";

/** A named, resolvable identity in the semantic model. Distinct from its syntactic occurrences. */
export interface Symbol {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly moduleId: ModuleId;
  readonly declarationLocation: SourceLocation;
  readonly visibility: Visibility;
  readonly exported: boolean;
  readonly typeText?: string;
}

export type ReferenceKind = "read" | "write" | "call" | "type-usage" | "import" | "export";

/** A single syntactic occurrence of a symbol, distinct from its declaration. */
export interface SymbolReference {
  readonly symbolId: SymbolId;
  readonly location: SourceLocation;
  readonly kind: ReferenceKind;
}

export type ImportKind = "named" | "default" | "namespace" | "side-effect" | "dynamic" | "re-export";

export interface ImportBinding {
  readonly fileId: FileId;
  readonly specifier: string;
  readonly kind: ImportKind;
  readonly importedName?: string;
  readonly localName?: string;
  readonly resolvedModuleId?: ModuleId;
  readonly location: SourceLocation;
}

export type ExportKind = "named" | "default" | "re-export";

export interface ExportBinding {
  readonly fileId: FileId;
  readonly kind: ExportKind;
  readonly exportedName: string;
  readonly symbolId?: SymbolId;
  readonly location: SourceLocation;
}
