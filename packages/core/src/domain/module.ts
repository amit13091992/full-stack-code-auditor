import type { FileId, ModuleId, SymbolId } from "./ids.js";
import type { ExportBinding, ImportBinding } from "./symbol.js";

/** The normalized unit of code organization — one per source file that participates in the module graph. */
export interface Module {
  readonly id: ModuleId;
  readonly fileId: FileId;
  readonly imports: readonly ImportBinding[];
  readonly exports: readonly ExportBinding[];
  readonly declaredSymbols: readonly SymbolId[];
}
