import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFile } from "../../packages/parser/src/index.js";
import { buildModuleGraph, buildSymbolGraph, moduleNodeId } from "../../packages/graph/src/index.js";
import type { FileId, Module, ClassEntity, FunctionEntity, Symbol as SymbolEntity } from "../../packages/core/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_LINKS_ROOT = path.resolve(__dirname, "../../fixtures/graph/module-links");
const PARSER_FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/parser/basic-constructs");

async function parseAll(root: string, relativePaths: readonly string[]) {
  const modules: Module[] = [];
  const symbols: SymbolEntity[] = [];
  const functions: FunctionEntity[] = [];
  const classes: ClassEntity[] = [];
  for (const relativePath of relativePaths) {
    const content = await fs.readFile(path.join(root, relativePath), "utf-8");
    const result = parseFile({ fileId: relativePath as FileId, path: relativePath, content });
    modules.push(result.module);
    symbols.push(...result.symbols);
    functions.push(...result.functions);
    classes.push(...result.classes);
  }
  return { modules, symbols, functions, classes };
}

describe("buildModuleGraph", () => {
  it("resolves relative imports (extensionless, .js->.ts, directory/index) and skips bare/unresolvable specifiers", async () => {
    const { modules } = await parseAll(MODULE_LINKS_ROOT, ["main.ts", "math.ts", "utils/index.ts"]);
    const graph = buildModuleGraph(modules);

    expect(graph.nodeCount).toBe(3);

    const mainNode = moduleNodeId("main.ts");
    const neighbors = graph.neighbors(mainNode, "IMPORTS").map((n) => n.entityId).sort();
    // main.ts imports ./math.js (resolves to math.ts) and ./utils (resolves to utils/index.ts).
    // The "left-pad" bare specifier and "./does-not-exist.js" relative-but-missing specifier
    // produce no edge at all — there's no project-internal node to point at.
    expect(neighbors).toEqual(["math.ts", "utils/index.ts"]);

    const edges = graph.query({ edgeType: "IMPORTS", fromNodeId: mainNode });
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.certainty === "resolved")).toBe(true);
  });

  it("produces a graph with only node objects and no edges for a project with no cross-file imports", async () => {
    const { modules } = await parseAll(PARSER_FIXTURES_ROOT, ["functions.ts"]);
    const graph = buildModuleGraph(modules);
    expect(graph.nodeCount).toBe(1);
    expect(graph.edgeCount).toBe(0);
  });

  it("resolves a multi-hop import chain (A imports B imports C), not just a single hop", async () => {
    const { modules } = await parseAll(MODULE_LINKS_ROOT, ["chain-a.ts", "chain-b.ts", "chain-c.ts"]);
    const graph = buildModuleGraph(modules);

    const aNode = moduleNodeId("chain-a.ts");
    const bNode = moduleNodeId("chain-b.ts");
    const cNode = moduleNodeId("chain-c.ts");

    expect(graph.neighbors(aNode, "IMPORTS").map((n) => n.entityId)).toEqual(["chain-b.ts"]);
    expect(graph.neighbors(bNode, "IMPORTS").map((n) => n.entityId)).toEqual(["chain-c.ts"]);
    // chain-c.ts imports nothing -> it's an isolated node with no outgoing edges.
    expect(graph.neighbors(cNode, "IMPORTS")).toEqual([]);

    // Prove the chain is actually walkable end to end, not just two independent single hops.
    const paths = graph.findPaths(aNode, cNode);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.edges.map((e) => e.toNodeId)).toEqual([bNode, cNode]);
  });

  it("resolves bare \".\" and \"..\" specifiers as relative imports, not bare/external ones (graph-engineer review)", async () => {
    const { modules } = await parseAll(MODULE_LINKS_ROOT, ["pkg/index.ts", "pkg/user.ts", "pkg/nested/child.ts"]);
    const graph = buildModuleGraph(modules);

    // "." from pkg/user.ts resolves to pkg/index.ts (same-directory index import).
    expect(graph.neighbors(moduleNodeId("pkg/user.ts"), "IMPORTS").map((n) => n.entityId)).toEqual(["pkg/index.ts"]);
    // ".." from pkg/nested/child.ts resolves to pkg/index.ts (parent-directory index import).
    expect(graph.neighbors(moduleNodeId("pkg/nested/child.ts"), "IMPORTS").map((n) => n.entityId)).toEqual(["pkg/index.ts"]);
  });

  it("resolves CommonJS require() imports too — the builder is binding-kind-agnostic, it only reads specifiers", async () => {
    const { modules } = await parseAll(MODULE_LINKS_ROOT, ["commonjs/main.js", "commonjs/helper.js"]);
    const graph = buildModuleGraph(modules);

    expect(graph.neighbors(moduleNodeId("commonjs/main.js"), "IMPORTS").map((n) => n.entityId)).toEqual(["commonjs/helper.js"]);
  });
});

describe("buildSymbolGraph", () => {
  it("produces DECLARES edges from a module to its symbols/functions/classes, and EXTENDS/IMPLEMENTS for same-file resolution", async () => {
    const { modules, symbols, functions, classes } = await parseAll(PARSER_FIXTURES_ROOT, ["shapes.ts"]);
    const graph = buildSymbolGraph(modules, symbols, functions, classes);

    const moduleNode = moduleNodeId("shapes.ts");
    const declared = graph.neighbors(moduleNode, "DECLARES");
    // Every top-level interface/type-alias/enum/class declared in shapes.ts should be reachable.
    const declaredNames = new Set(declared.map((n) => n.entityId));
    expect(declaredNames.size).toBeGreaterThan(0);

    const circle = classes.find((c) => c.name === "Circle");
    const shape = classes.find((c) => c.name === "Shape");
    expect(circle).toBeDefined();
    expect(shape).toBeDefined();

    const extendsEdges = graph.query({ edgeType: "EXTENDS" });
    expect(extendsEdges.some((e) => e.fromNodeId.includes(circle!.id) && e.toNodeId.includes(shape!.symbolId))).toBe(true);

    const implementsEdges = graph.query({ edgeType: "IMPLEMENTS" });
    expect(implementsEdges.filter((e) => e.fromNodeId.includes(circle!.id))).toHaveLength(2); // Point and Sized

    // InternalHelper is a plain class with no extends/implements clause at all — it should still
    // get a DECLARES edge from the module, but no EXTENDS/IMPLEMENTS edges of its own.
    const internalHelper = classes.find((c) => c.name === "InternalHelper");
    expect(internalHelper).toBeDefined();
    expect(extendsEdges.some((e) => e.fromNodeId.includes(internalHelper!.id))).toBe(false);
    expect(implementsEdges.some((e) => e.fromNodeId.includes(internalHelper!.id))).toBe(false);
  });

  it("gives a top-level function/class not nested in a class a direct module -> function/class DECLARES edge", async () => {
    const { modules, functions } = await parseAll(PARSER_FIXTURES_ROOT, ["functions.ts"]);
    const graph = buildSymbolGraph(modules, [], functions, []);

    const moduleNode = moduleNodeId("functions.ts");
    const add = functions.find((f) => f.name === "add");
    expect(add).toBeDefined();

    // This is the module -> function DECLARES edge added directly in the functions loop
    // (symbol-graph.ts), not the module.declaredSymbols -> symbol DECLARES edge — no Symbol
    // entities were passed in here at all, so this edge can only come from that direct loop.
    const declaresEdges = graph.query({ edgeType: "DECLARES", fromNodeId: moduleNode });
    expect(declaresEdges.some((e) => e.toNodeId.includes(add!.id))).toBe(true);
  });
});
