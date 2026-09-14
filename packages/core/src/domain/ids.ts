/**
 * Branded identifier types. Every domain entity is addressed by a stable,
 * content- or path-derived ID so that graph edges, findings, and incremental
 * caches can reference entities without holding live object references.
 */

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ProjectId = Brand<string, "ProjectId">;
export type RepositoryId = Brand<string, "RepositoryId">;
export type FileId = Brand<string, "FileId">;
export type ModuleId = Brand<string, "ModuleId">;
export type SymbolId = Brand<string, "SymbolId">;
export type FunctionId = Brand<string, "FunctionId">;
export type ClassId = Brand<string, "ClassId">;
export type DependencyId = Brand<string, "DependencyId">;
export type EndpointId = Brand<string, "EndpointId">;
export type DatabaseEntityId = Brand<string, "DatabaseEntityId">;
export type ServiceId = Brand<string, "ServiceId">;
export type SecurityBoundaryId = Brand<string, "SecurityBoundaryId">;
export type DataFlowId = Brand<string, "DataFlowId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type FindingId = Brand<string, "FindingId">;
export type ScanId = Brand<string, "ScanId">;
export type NodeId = Brand<string, "NodeId">;
export type EdgeId = Brand<string, "EdgeId">;

/** A zero-based, half-open [start, end) position in a file, in both offset and line/column form. */
export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

/** Points at an exact, reproducible location in the repository under analysis. */
export interface SourceLocation {
  readonly fileId: FileId;
  readonly path: string;
  readonly range?: SourceRange;
}

/** Arbitrary structured metadata attached to a domain entity. Never used for control flow. */
export type Metadata = Readonly<Record<string, string | number | boolean | null>>;
