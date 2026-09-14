/**
 * @code-analyzer/project-model — Phase 1 (Repository Intelligence).
 *
 * Implements `RepositoryDiscoverer` from `@code-analyzer/core`
 * (see packages/core/src/analyzer/pipeline.ts): filesystem discovery, ignore handling, source
 * classification, generated-code detection, language/framework/package-manager detection,
 * producing a normalized `ProjectModel`. See docs/tasks/phase-1-repository-discovery.md.
 */
export { projectModelDiscoverer } from "./discover.js";
export { classifyLanguage, classifySource } from "./classify.js";
export { detectFrameworks } from "./frameworks.js";
export { detectPackageManager, detectWorkspacePackages, readPackageJson } from "./package-manager.js";
export type { PackageJson } from "./package-manager.js";
export { walkRepository } from "./walk.js";
export type { WalkOptions } from "./walk.js";
export { hashContent } from "./hash.js";
export { isBinary } from "./binary.js";
