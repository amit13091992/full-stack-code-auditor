import type { FileId, Metadata } from "./ids.js";

export type SourceClassification =
  | "source"
  | "test"
  | "config"
  | "infrastructure"
  | "generated"
  | "vendored"
  | "documentation"
  | "asset"
  | "unknown";

export type LanguageId =
  | "javascript"
  | "typescript"
  | "json"
  | "yaml"
  | "sql"
  | "dockerfile"
  | "unknown";

/** A single file discovered in the repository, classified but not yet parsed. */
export interface SourceFile {
  readonly id: FileId;
  /** Path relative to the repository root. Always forward-slash separated. */
  readonly path: string;
  readonly absolutePath: string;
  readonly language: LanguageId;
  readonly classification: SourceClassification;
  readonly sizeBytes: number;
  /** Content hash used as the cache key for incremental analysis. */
  readonly contentHash: string;
  readonly encoding: "utf-8" | "binary";
  readonly metadata?: Metadata;
}
