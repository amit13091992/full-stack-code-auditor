/**
 * Single source of truth for upload/extraction/scan bounds — an unauthenticated HTTP endpoint
 * accepting arbitrary uploaded archives needs hard ceilings before any inflate/parse work runs.
 */
export interface ApiLimits {
  /** Max bytes accepted for the raw uploaded multipart part (compressed, pre-extraction). */
  readonly maxUploadBytes: number;
  /** Max uncompressed bytes for any single zip entry, checked against its declared size and re-checked against actual bytes written. */
  readonly maxEntryBytes: number;
  /** Max total uncompressed bytes across all zip entries combined — the zip-bomb ceiling. */
  readonly maxTotalUncompressedBytes: number;
  /** Max number of entries a zip archive may contain. */
  readonly maxEntryCount: number;
  /** Wall-clock budget for a single scan, enforced via AbortSignal. */
  readonly scanTimeoutMs: number;
}

export const DEFAULT_LIMITS: ApiLimits = {
  maxUploadBytes: 50 * 1024 * 1024,
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxEntryCount: 5000,
  scanTimeoutMs: 120_000,
};
