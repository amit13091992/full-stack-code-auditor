import type { ClassEntity } from "./class.js";
import type { DatabaseEntity } from "./database-entity.js";
import type { Dependency } from "./dependency.js";
import type { EndpointModel } from "./endpoint.js";
import type { SourceFile } from "./file.js";
import type { FunctionEntity } from "./function.js";
import type { ProjectId } from "./ids.js";
import type { Module } from "./module.js";
import type { Repository } from "./repository.js";
import type { SecurityBoundary } from "./security-boundary.js";
import type { ServiceEntity } from "./service.js";
import type { Symbol as SymbolEntity } from "./symbol.js";

export type FrameworkId =
  | "react"
  | "react-native"
  | "angular"
  | "vue"
  | "node"
  | "express"
  | "nestjs"
  | "nextjs"
  | "unknown";

/**
 * The normalized, framework-aware representation of an entire codebase (Section 2: "Normalized
 * Project Model"). This is the artifact every analyzer reads from — analyzers never parse source
 * files directly. Populated incrementally across Phases 1-3; a Phase 0 ProjectModel may have
 * empty collections beyond `repository` and `files`.
 */
export interface ProjectModel {
  readonly id: ProjectId;
  readonly repository: Repository;
  readonly frameworks: readonly FrameworkId[];
  readonly files: readonly SourceFile[];
  readonly modules: readonly Module[];
  readonly symbols: readonly SymbolEntity[];
  readonly functions: readonly FunctionEntity[];
  readonly classes: readonly ClassEntity[];
  readonly dependencies: readonly Dependency[];
  readonly endpoints: readonly EndpointModel[];
  readonly databaseEntities: readonly DatabaseEntity[];
  readonly services: readonly ServiceEntity[];
  readonly securityBoundaries: readonly SecurityBoundary[];
}
