# Domain Model

All types live in `packages/core/src/domain/`, one file per entity, re-exported from
`packages/core/src/domain/index.ts`. Every entity is identified by a branded ID type from
`ids.ts` (`ProjectId`, `FileId`, `SymbolId`, ...) so IDs from different entity kinds can't be
accidentally interchanged — the TypeScript compiler rejects passing a `FunctionId` where a
`ClassId` is expected even though both are strings at runtime.

| Entity | File | Populated by |
|---|---|---|
| `RepositoryMetadata` / `Repository` | `repository.ts` | Phase 1 discovery |
| `SourceFile` | `file.ts` | Phase 1 discovery |
| `Module` | `module.ts` | Phase 2 parsing |
| `Symbol`, `SymbolReference`, `ImportBinding`, `ExportBinding` | `symbol.ts` | Phase 2 parsing |
| `FunctionEntity` | `function.ts` | Phase 2 parsing |
| `ClassEntity` | `class.ts` | Phase 2 parsing |
| `Dependency` | `dependency.ts` | Phase 1 discovery + Section 13 vulnerability/reachability analysis |
| `AuthenticationModel` / `AuthorizationModel` | `auth.ts` | Security engine (Section 8/9) |
| `EndpointModel` | `endpoint.ts` | Framework-specific API discovery (Section 10) |
| `DatabaseEntity` | `database-entity.ts` | ORM/SQL adapters (Section 11) |
| `ServiceEntity` | `service.ts` | Architecture engine (Section 16) |
| `SecurityBoundary` | `security-boundary.ts` | Architecture engine (Section 16) |
| `DataFlow` | `data-flow.ts` | Taint engine (Section 6) |
| `Evidence` | `evidence.ts` | Any analyzer, attached to a `Finding` |
| `Finding` | `finding.ts` | Any analyzer |
| `Scan` | `scan.ts` | `ScanEngine` |
| `ProjectModel` | `project.ts` | Aggregates all of the above; the only thing analyzers read |

## Design rules that apply to every entity

1. **Immutable.** Every field is `readonly`. An entity is never mutated after construction — a
   later phase producing new information creates a new value (e.g. a `Dependency` with `reachable`
   now set) rather than mutating the one built during discovery.
2. **IDs, not object references, for cross-entity links.** `FunctionEntity.ownerClassId` is a
   `ClassId`, not a `ClassEntity`. This keeps the model serializable (Section 37H) and cache-able
   (Section 29) without cycles.
3. **Uncertainty is representable, never defaulted away.** See ADR-0004. If a field's true value is
   "not yet known" (e.g. `Dependency.reachable`), its type is `T | undefined`, not `T` defaulting to
   a value that implies a conclusion.
4. **Every entity that represents "a thing that happened at a place in source" carries a
   `SourceLocation`.** This is what makes Evidence/Finding traceability (Section 20, Section 35.9)
   possible — nothing in the model asserts something about code without saying where.

## Adding a new domain entity

1. Confirm no existing entity already covers it (Section 35.12: avoid a new abstraction when an
   existing one is sufficient).
2. Add the file under `packages/core/src/domain/`, export it from `domain/index.ts`.
3. If it needs a stable identity, add a branded ID type to `ids.ts`.
4. If other entities will reference it, decide ID-by-reference (preferred) vs. inlining.
5. Update this table and, if the addition changes a contract another package already depends on,
   write an ADR (Section 43/46).
