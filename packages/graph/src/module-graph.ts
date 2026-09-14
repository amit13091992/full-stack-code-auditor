import path from "node:path";
import type { Graph, Module } from "@code-analyzer/core";
import { InMemoryGraph } from "./in-memory-graph.js";
import { edgeId, moduleNodeId } from "./node-ids.js";

const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

/**
 * Resolves a relative import specifier (`"./foo"`, `"../bar/baz"`, or the bare-directory forms
 * `"."`/`".."`) against the importing module's own path, trying each candidate extension and an
 * `/index.*` fallback, against the set of actually-parsed module paths. Returns `undefined` for a
 * bare specifier (no relative-import form — an external package) or a relative specifier that
 * doesn't match any parsed module (Phase 3's documented non-goal: no node_modules/external-package
 * resolution).
 */
function isRelativeSpecifier(specifier: string): boolean {
  // "." and ".." are valid relative-directory-import forms (e.g. `import x from ".."`) — not
  // bare/external specifiers, even though they don't start with "./" or "../" (graph-engineer
  // review, Phase 3 checkpoint).
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
}

function resolveRelativeSpecifier(importingModulePath: string, specifier: string, knownModulePaths: ReadonlySet<string>): string | undefined {
  if (!isRelativeSpecifier(specifier)) return undefined;

  const importingDir = path.posix.dirname(importingModulePath);
  const joined = path.posix.normalize(path.posix.join(importingDir, specifier));

  if (knownModulePaths.has(joined)) return joined;

  // Extensionless specifier ("./math") -> try appending each resolvable extension.
  for (const ext of RESOLVABLE_EXTENSIONS) {
    if (knownModulePaths.has(`${joined}${ext}`)) return `${joined}${ext}`;
  }

  // ESM-style TS specifier ("./math.js" pointing at math.ts on disk) -> strip the given extension
  // and retry every resolvable extension, not just re-append the one already there.
  const existingExt = RESOLVABLE_EXTENSIONS.find((ext) => joined.endsWith(ext));
  if (existingExt) {
    const withoutExt = joined.slice(0, -existingExt.length);
    for (const ext of RESOLVABLE_EXTENSIONS) {
      if (knownModulePaths.has(`${withoutExt}${ext}`)) return `${withoutExt}${ext}`;
    }
  }

  // Directory import ("./utils" resolving to "./utils/index.ts").
  for (const ext of RESOLVABLE_EXTENSIONS) {
    const indexPath = path.posix.join(joined, `index${ext}`);
    if (knownModulePaths.has(indexPath)) return indexPath;
  }
  return undefined;
}

/**
 * Builds the Module Graph (Phase 3, docs/tasks/phase-3-graph-foundation.md): one node per
 * `Module`, an `IMPORTS` edge for every `ImportBinding` whose specifier resolves to another
 * parsed module in the project. Cross-file resolution is exactly what ADR-0006 deferred from
 * Phase 2 to here. Bare/external specifiers and unresolvable relative ones produce no edge —
 * there is no project-internal node to point at (see the function doc above).
 */
export function buildModuleGraph(modules: readonly Module[]): Graph {
  const graph = new InMemoryGraph();
  const knownModulePaths = new Set(modules.map((m) => m.id as string));

  for (const module of modules) {
    graph.addNode({ id: moduleNodeId(module.id), type: "module", entityId: module.id });
  }

  for (const module of modules) {
    const fromId = moduleNodeId(module.id);
    for (const binding of module.imports) {
      const resolvedPath = resolveRelativeSpecifier(module.id as string, binding.specifier, knownModulePaths);
      if (!resolvedPath) continue;
      const toId = moduleNodeId(resolvedPath);
      const id = edgeId("IMPORTS", fromId, toId);
      if (graph.getEdge(id)) continue; // multiple bindings from the same specifier -> one edge
      graph.addEdge({ id, type: "IMPORTS", fromNodeId: fromId, toNodeId: toId, certainty: "resolved" });
    }
  }

  return graph;
}
