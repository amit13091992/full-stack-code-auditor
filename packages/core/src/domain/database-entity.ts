import type { DatabaseEntityId, SourceLocation, SymbolId } from "./ids.js";

export type DatabaseKind = "postgres" | "mysql" | "sqlite" | "mongodb" | "redis" | "other";

export type OrmKind = "prisma" | "typeorm" | "sequelize" | "mongoose" | "drizzle" | "raw-sql" | "unknown";

export interface EntityField {
  readonly name: string;
  readonly typeText?: string;
  readonly isPrimaryKey: boolean;
  readonly isSensitive?: boolean;
  readonly nullable: boolean;
}

/** A normalized schema entity (table/collection) discovered via an ORM or raw SQL/migration source. */
export interface DatabaseEntity {
  readonly id: DatabaseEntityId;
  readonly name: string;
  readonly database: DatabaseKind;
  readonly orm: OrmKind;
  readonly fields: readonly EntityField[];
  readonly definitionSymbolId?: SymbolId;
  readonly location: SourceLocation;
}
