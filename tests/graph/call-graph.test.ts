import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFile } from "../../packages/parser/src/index.js";
import { buildCallGraph, functionNodeId } from "../../packages/graph/src/index.js";
import type { ClassEntity, FileId, FunctionEntity, Module } from "../../packages/core/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CALL_LINKS_ROOT = path.resolve(__dirname, "../../fixtures/graph/call-links");

async function parseAll(relativePaths: readonly string[]) {
  const modules: Module[] = [];
  const functions: FunctionEntity[] = [];
  const classes: ClassEntity[] = [];
  for (const relativePath of relativePaths) {
    const content = await fs.readFile(path.join(CALL_LINKS_ROOT, relativePath), "utf-8");
    const result = parseFile({ fileId: relativePath as FileId, path: relativePath, content });
    modules.push(result.module);
    functions.push(...result.functions);
    classes.push(...result.classes);
  }
  return { modules, functions, classes };
}

describe("buildCallGraph", () => {
  it("resolves a same-file call as direct and a cross-file imported call as resolved", async () => {
    const { modules, functions, classes } = await parseAll(["direct.ts", "helper.ts"]);
    const graph = buildCallGraph(modules, functions, classes);

    const caller = functions.find((f) => f.name === "callsBoth")!;
    const localAdd = functions.find((f) => f.name === "localAdd")!;
    const helper = functions.find((f) => f.name === "helper")!;

    const edges = graph.query({ edgeType: "CALLS", fromNodeId: functionNodeId(caller.id) });
    expect(edges).toHaveLength(2);

    const toLocalAdd = edges.find((e) => e.toNodeId === functionNodeId(localAdd.id));
    expect(toLocalAdd?.certainty).toBe("direct");

    const toHelper = edges.find((e) => e.toNodeId === functionNodeId(helper.id));
    expect(toHelper?.certainty).toBe("resolved");
  });

  it("resolves a literal computed-member call like a normal member call, and marks a variable computed-member call dynamic", async () => {
    const { modules, functions, classes } = await parseAll(["dynamic-dispatch.ts"]);
    const graph = buildCallGraph(modules, functions, classes);

    const literalKey = functions.find((f) => f.name === "literalKey")!;
    const variableKey = functions.find((f) => f.name === "variableKey")!;

    // obj["method"]() -> the object is a local variable, not a class/import -> not statically
    // resolvable to a declaration even though the key is literal, so it still lands as an
    // "unknown" call-site (no type inference over local object-literal shapes in this phase).
    const literalEdges = graph.query({ edgeType: "CALLS", fromNodeId: functionNodeId(literalKey.id) });
    expect(literalEdges).toHaveLength(1);
    expect(literalEdges[0]?.certainty).toBe("unknown");

    const variableEdges = graph.query({ edgeType: "CALLS", fromNodeId: functionNodeId(variableKey.id) });
    expect(variableEdges).toHaveLength(1);
    expect(variableEdges[0]?.certainty).toBe("dynamic");
  });

  it("resolves .call()/.apply() on a cross-file imported function and marks an unresolvable receiver dynamic", async () => {
    const { modules, functions, classes } = await parseAll(["call-apply-bind.ts", "helper.ts"]);
    const graph = buildCallGraph(modules, functions, classes);

    const caller = functions.find((f) => f.name === "usesCallApplyBind")!;
    const helper = functions.find((f) => f.name === "helper")!;

    const edges = graph.query({ edgeType: "CALLS", fromNodeId: functionNodeId(caller.id) });
    // a = helper.call(...), b = helper.apply(...) -> both resolve to the same target function,
    // deduplicating into one structural edge; c = receiver.call(...) -> receiver is a parameter,
    // unresolvable -> a second, "dynamic" call-site edge.
    const toHelper = edges.find((e) => e.toNodeId === functionNodeId(helper.id));
    expect(toHelper?.certainty).toBe("resolved");

    const dynamicEdges = edges.filter((e) => e.certainty === "dynamic");
    expect(dynamicEdges).toHaveLength(1);
  });

  it("represents a callback passed as an argument with an additional unknown edge, without dropping it", async () => {
    const { modules, functions, classes } = await parseAll(["callback-argument.ts"]);
    const graph = buildCallGraph(modules, functions, classes);

    const caller = functions.find((f) => f.name === "processAll")!;
    // The inline arrow passed to .map() is its own nested FunctionEntity.
    const callback = functions.find((f) => f.name !== "processAll")!;
    expect(callback).toBeDefined();

    const edges = graph.query({ edgeType: "CALLS", fromNodeId: functionNodeId(caller.id) });
    const toCallback = edges.find((e) => e.toNodeId === functionNodeId(callback.id));
    expect(toCallback?.certainty).toBe("unknown");

    // The call's own callee (`items.map`) has an unresolvable receiver (a plain parameter, no
    // type inference in this phase) -> a second "unknown" call-site edge represents that half,
    // never silently dropped. Two edges total: one for "map" itself, one for callback reachability.
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.certainty === "unknown")).toBe(true);
  });

  it("resolves a cross-file EXTENDS chain no better than unknown (Phase 3's same-file-only inheritance gap)", async () => {
    const { modules, functions, classes } = await parseAll(["inheritance-base.ts", "inheritance-child.ts"]);
    const graph = buildCallGraph(modules, functions, classes);

    const caller = functions.find((f) => f.name === "callsGreet")!;
    const edges = graph.query({ edgeType: "CALLS", fromNodeId: functionNodeId(caller.id) });
    expect(edges).toHaveLength(1);
    expect(edges[0]?.certainty).toBe("unknown");
  });

  it("resolves a same-file this.method() call as direct", async () => {
    const { modules, functions, classes } = await parseAll(["same-file-this.ts"]);
    const graph = buildCallGraph(modules, functions, classes);

    const render = functions.find((f) => f.name === "render")!;
    const label = functions.find((f) => f.name === "label")!;

    const edges = graph.query({ edgeType: "CALLS", fromNodeId: functionNodeId(render.id) });
    expect(edges).toHaveLength(1);
    expect(edges[0]?.toNodeId).toBe(functionNodeId(label.id));
    expect(edges[0]?.certainty).toBe("direct");
  });
});
