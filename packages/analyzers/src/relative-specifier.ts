import path from "node:path";

const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

/**
 * Same relative-specifier form check and resolution algorithm as `buildModuleGraph`
 * (packages/graph/src/module-graph.ts) — duplicated here rather than imported because the Module
 * Graph builder doesn't retain which `ImportBinding` produced which `IMPORTS` edge, so an analyzer
 * that needs to point a `Finding`/`Evidence` at the exact import statement (not just "an edge
 * exists") has to re-derive the same resolved target from the binding itself. Keeping the algorithm
 * identical to the builder's is what makes "no edge" and "resolution failed here" the same fact.
 */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
}

export function resolveRelativeSpecifier(importingModulePath: string, specifier: string, knownModulePaths: ReadonlySet<string>): string | undefined {
  if (!isRelativeSpecifier(specifier)) return undefined;

  const importingDir = path.posix.dirname(importingModulePath);
  const joined = path.posix.normalize(path.posix.join(importingDir, specifier));

  if (knownModulePaths.has(joined)) return joined;

  for (const ext of RESOLVABLE_EXTENSIONS) {
    if (knownModulePaths.has(`${joined}${ext}`)) return `${joined}${ext}`;
  }

  const existingExt = RESOLVABLE_EXTENSIONS.find((ext) => joined.endsWith(ext));
  if (existingExt) {
    const withoutExt = joined.slice(0, -existingExt.length);
    for (const ext of RESOLVABLE_EXTENSIONS) {
      if (knownModulePaths.has(`${withoutExt}${ext}`)) return `${withoutExt}${ext}`;
    }
  }

  for (const ext of RESOLVABLE_EXTENSIONS) {
    const indexPath = path.posix.join(joined, `index${ext}`);
    if (knownModulePaths.has(indexPath)) return indexPath;
  }
  return undefined;
}
