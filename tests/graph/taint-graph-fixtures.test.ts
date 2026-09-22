import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFile } from "../../packages/parser/src/index.js";
import { buildCallGraph, buildTaintGraph, functionNodeId } from "../../packages/graph/src/index.js";
import type { ClassEntity, FileId, FunctionEntity, Module } from "../../packages/core/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAINT_LINKS_ROOT = path.resolve(__dirname, "../../fixtures/graph/taint-links");

async function parseOne(relativePath: string) {
  const modules: Module[] = [];
  const functions: FunctionEntity[] = [];
  const classes: ClassEntity[] = [];
  const content = await fs.readFile(path.join(TAINT_LINKS_ROOT, relativePath), "utf-8");
  const result = parseFile({ fileId: relativePath as FileId, path: relativePath, content });
  modules.push(result.module);
  functions.push(...result.functions);
  classes.push(...result.classes);
  return { modules, functions, classes };
}

/**
 * These tests exercise the real parser -> Call Graph -> Taint Graph pipeline over real source
 * fixtures (`fixtures/graph/taint-links/`), the pipeline `tests/graph/taint-graph.test.ts`'s
 * hand-built-`FunctionEntity` unit tests deliberately don't cover (docs/tasks/phase-5-taint-graph.md
 * checklist step 7; Phase 4 precedent: `tests/graph/call-graph.test.ts`).
 */
describe("buildTaintGraph over real parsed fixtures", () => {
  it("produces an unsanitized FLOWS_TO edge for req.query.id flowing into db.query unmodified", async () => {
    const { modules, functions, classes } = await parseOne("unsanitized-flow.ts");
    const callGraph = buildCallGraph(modules, functions, classes);
    const taintGraph = buildTaintGraph(functions, callGraph);

    const handler = functions.find((f) => f.name === "handleUnsanitized")!;
    const edges = taintGraph.query({ edgeType: "FLOWS_TO", fromNodeId: functionNodeId(handler.id) });
    expect(edges).toHaveLength(1);
    expect(edges[0]?.certainty).toBe("direct");
    expect(edges[0]?.data?.sanitized).toBe(false);
    expect(edges[0]?.data?.sourceKind).toBe("query-parameter");
    expect(edges[0]?.data?.sinkKind).toBe("sql");
  });

  it("marks sanitized: true when a recognized sanitizer (parseInt) sits between source and sink", async () => {
    const { modules, functions, classes } = await parseOne("sanitized-flow.ts");
    const callGraph = buildCallGraph(modules, functions, classes);
    const taintGraph = buildTaintGraph(functions, callGraph);

    const handler = functions.find((f) => f.name === "handleSanitized")!;
    const edges = taintGraph.query({ edgeType: "FLOWS_TO", fromNodeId: functionNodeId(handler.id) });
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.sanitized).toBe(true);
  });

  it("still produces a FLOWS_TO edge, with reduced certainty, through an 'unknown' callback-reachability CALLS edge", async () => {
    const { modules, functions, classes } = await parseOne("unknown-edge-flow.ts");
    const callGraph = buildCallGraph(modules, functions, classes);
    const taintGraph = buildTaintGraph(functions, callGraph);

    const source = functions.find((f) => f.name === "processRequest")!;
    const edges = taintGraph.query({ edgeType: "FLOWS_TO", fromNodeId: functionNodeId(source.id) });
    expect(edges).toHaveLength(1);
    expect(edges[0]?.certainty).toBe("unknown");
    expect(edges[0]?.data?.sanitized).toBe(false);
    expect(edges[0]?.data?.sinkKind).toBe("sql");
  });

  it("produces no FLOWS_TO edge when a source is only ever passed to a safe, unrecognized sink", async () => {
    const { modules, functions, classes } = await parseOne("false-positive-safe-sink.ts");
    const callGraph = buildCallGraph(modules, functions, classes);
    const taintGraph = buildTaintGraph(functions, callGraph);

    expect(taintGraph.query({ edgeType: "FLOWS_TO" })).toHaveLength(0);
  });

  it("produces zero taint-graph edges when no recognized source or sink is present at all", async () => {
    const { modules, functions, classes } = await parseOne("no-source-no-sink.ts");
    const callGraph = buildCallGraph(modules, functions, classes);
    const taintGraph = buildTaintGraph(functions, callGraph);

    expect(taintGraph.edgeCount).toBe(0);
  });
});
