import type { CoverageModel } from "../domain/coverage.js";
import type { ScanMode, ScanProfile } from "../domain/scan.js";
import type { ScanEventListener } from "../events/events.js";

export interface IgnoreConfig {
  readonly patterns: readonly string[];
  readonly respectGitignore: boolean;
}

export interface IncrementalConfig {
  readonly enabled: boolean;
  readonly cacheDir?: string;
  readonly baseRef?: string;
}

export interface SandboxConfig {
  readonly enabled: boolean;
  readonly cpuLimitMs?: number;
  readonly memoryLimitMb?: number;
  readonly timeoutMs?: number;
  readonly networkAccess: boolean;
}

export interface ReasoningProviderConfig {
  readonly providerId: string;
  readonly enabled: boolean;
}

/** Root configuration model (Section 37G). Resolved from defaults + config file + programmatic overrides. */
export interface AnalyzerConfig {
  readonly root: string;
  readonly profile: ScanProfile;
  readonly analyzers?: readonly string[];
  readonly ignore: IgnoreConfig;
  readonly incremental: IncrementalConfig;
  readonly sandbox: SandboxConfig;
  readonly reasoning?: ReasoningProviderConfig;
  readonly plugins?: readonly string[];
}

/** Per-invocation overrides passed to `analyzer.scan(options)`. */
export interface ScanOptions {
  readonly profile?: ScanProfile;
  readonly analyzers?: readonly string[];
  readonly mode?: ScanMode;
  readonly changedFiles?: readonly string[];
  readonly baseCommit?: string;
  readonly headCommit?: string;
  readonly signal?: AbortSignal;
  /** Pre-ingested test coverage (`packages/integrations/src/coverage/*`), surfaced to analyzers via `AnalyzerContext.coverage`. */
  readonly coverage?: CoverageModel;
  /** External subscriber for scan lifecycle events (e.g. an API layer streaming progress over SSE). ADR-0012. */
  readonly onEvent?: ScanEventListener;
}
