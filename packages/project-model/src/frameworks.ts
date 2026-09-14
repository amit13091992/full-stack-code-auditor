import type { FrameworkId } from "@code-analyzer/core";
import type { PackageJson } from "./package-manager.js";

const FRAMEWORK_ORDER: readonly FrameworkId[] = ["node", "express", "nestjs", "nextjs", "react", "react-native", "angular", "vue"];

/**
 * Detects Section 5's initial framework list from merged dependency names across the root and
 * every workspace package. `node` is reported whenever any `package.json` exists — every
 * supported framework here is a Node.js/npm-ecosystem framework, so its absence would be the
 * surprising case, not its presence.
 */
export function detectFrameworks(packageJsons: readonly PackageJson[]): readonly FrameworkId[] {
  if (packageJsons.length === 0) return [];

  const dependencyNames = new Set<string>();
  for (const pkg of packageJsons) {
    for (const name of Object.keys(pkg.dependencies ?? {})) dependencyNames.add(name);
    for (const name of Object.keys(pkg.devDependencies ?? {})) dependencyNames.add(name);
  }

  const detected = new Set<FrameworkId>(["node"]);
  if (dependencyNames.has("react")) detected.add("react");
  if (dependencyNames.has("react-native")) detected.add("react-native");
  if (dependencyNames.has("express")) detected.add("express");
  if (dependencyNames.has("next")) detected.add("nextjs");
  if (dependencyNames.has("@nestjs/core")) detected.add("nestjs");
  if (dependencyNames.has("@angular/core")) detected.add("angular");
  if (dependencyNames.has("vue")) detected.add("vue");

  return FRAMEWORK_ORDER.filter((framework) => detected.has(framework));
}
