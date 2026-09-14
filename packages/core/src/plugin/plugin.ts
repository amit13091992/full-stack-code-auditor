import type { Analyzer } from "../analyzer/analyzer.js";

/**
 * A plugin is an externally authored Analyzer plus install-time metadata (Section 27). The
 * `analyze`/`supports` shape is identical to `Analyzer` on purpose — a plugin is not a different
 * kind of thing, it is an Analyzer that did not ship in `@code-analyzer/analyzers`.
 */
export interface AnalyzerPlugin extends Analyzer {
  readonly author?: string;
  readonly homepage?: string;
  /** Semver range of `@code-analyzer/core` this plugin was built against. */
  readonly coreVersionRange: string;
}

export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly entryPoint: string;
  readonly coreVersionRange: string;
}

/** What a plugin host (CLI, IDE extension, CI action) must provide to load and run plugins safely. */
export interface PluginHost {
  loadPlugin(manifest: PluginManifest): Promise<AnalyzerPlugin>;
  unloadPlugin(id: string): Promise<void>;
  listLoadedPlugins(): readonly AnalyzerPlugin[];
}
