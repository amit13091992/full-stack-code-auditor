import type { EdgeCertainty, FunctionEntity, Graph, TaintSinkKind, TaintSourceKind } from "@code-analyzer/core";
import { InMemoryGraph } from "./in-memory-graph.js";
import { edgeId, functionNodeId } from "./node-ids.js";
import { TAINT_SIGNATURES, matchesCallSite, type TaintSignature } from "./taint-signatures.js";

/**
 * Builds the Taint Graph (Phase 5, `docs/tasks/phase-5-taint-graph.md` checklist step 4,
 * ADR-0014): `FLOWS_TO` edges from a function containing a recognized taint source call site to a
 * function containing a recognized sink call site, reusing the already-built Call Graph's `CALLS`
 * edges (and their `EdgeCertainty`) for reachability instead of any new resolution logic
 * (Section 35.12). Argument-position propagation only, per the scoping doc's Non-goals — no
 * points-to/alias analysis.
 *
 * Nodes are exactly the Call Graph's function nodes (`functionNodeId`) — no parallel node scheme.
 */

export interface TaintFlowEdgeData {
  readonly sourceKind: TaintSourceKind;
  readonly sinkKind: TaintSinkKind;
  /** Every matched source/sanitizer/sink signature name involved, for traceability. */
  readonly sourceSignatures: readonly string[];
  readonly sinkSignatures: readonly string[];
  readonly sanitized: boolean;
}

interface FunctionTaintMatches {
  readonly sources: readonly TaintSignature[];
  readonly sinks: readonly TaintSignature[];
  readonly sanitizers: readonly TaintSignature[];
}

// Lowest to highest confidence — used to find the weakest CALLS edge certainty along a path.
const CERTAINTY_ORDER: readonly EdgeCertainty[] = ["unknown", "dynamic", "inferred", "resolved", "direct"];

function certaintyRank(certainty: EdgeCertainty): number {
  return CERTAINTY_ORDER.indexOf(certainty);
}

function weakestCertainty(certainties: readonly EdgeCertainty[]): EdgeCertainty {
  let weakest: EdgeCertainty = "direct";
  for (const c of certainties) {
    if (certaintyRank(c) < certaintyRank(weakest)) weakest = c;
  }
  return weakest;
}

function classifyFunction(fn: FunctionEntity): FunctionTaintMatches {
  const sources: TaintSignature[] = [];
  const sinks: TaintSignature[] = [];
  const sanitizers: TaintSignature[] = [];
  for (const site of fn.calls) {
    for (const signature of TAINT_SIGNATURES) {
      if (!matchesCallSite(site, signature.match)) continue;
      if (signature.kind === "source") sources.push(signature);
      else if (signature.kind === "sink") sinks.push(signature);
      else sanitizers.push(signature);
    }
  }
  return { sources, sinks, sanitizers };
}

export function buildTaintGraph(functions: readonly FunctionEntity[], callGraph: Graph): Graph<unknown, TaintFlowEdgeData> {
  const graph = new InMemoryGraph<unknown, TaintFlowEdgeData>();

  for (const fn of functions) {
    graph.addNode({ id: functionNodeId(fn.id), type: "function", entityId: fn.id });
  }

  const matchesByFunction = new Map<string, FunctionTaintMatches>();
  for (const fn of functions) matchesByFunction.set(fn.id as string, classifyFunction(fn));

  const sourceFunctions = functions.filter((fn) => (matchesByFunction.get(fn.id as string)?.sources.length ?? 0) > 0);
  const sinkFunctions = functions.filter((fn) => (matchesByFunction.get(fn.id as string)?.sinks.length ?? 0) > 0);

  function hasSanitizer(fn: FunctionEntity): boolean {
    return (matchesByFunction.get(fn.id as string)?.sanitizers.length ?? 0) > 0;
  }

  for (const sourceFn of sourceFunctions) {
    for (const sinkFn of sinkFunctions) {
      const sourceMatches = matchesByFunction.get(sourceFn.id as string)!.sources;
      const sinkMatches = matchesByFunction.get(sinkFn.id as string)!.sinks;

      let certainty: EdgeCertainty;
      let sanitized: boolean;

      if (sourceFn.id === sinkFn.id) {
        certainty = "direct";
        sanitized = hasSanitizer(sourceFn);
      } else {
        const paths = callGraph.findPaths(functionNodeId(sourceFn.id), functionNodeId(sinkFn.id));
        if (paths.length === 0) continue;
        const path = paths[0]!;
        certainty = weakestCertainty(path.edges.map((e) => e.certainty));
        const intermediateFunctions = path.nodes.filter((n) => n.type === "function");
        sanitized = intermediateFunctions.some((n) => {
          const fn = functions.find((f) => functionNodeId(f.id) === n.id);
          return fn !== undefined && hasSanitizer(fn);
        });
      }

      const id = edgeId("FLOWS_TO", functionNodeId(sourceFn.id), functionNodeId(sinkFn.id));
      if (graph.getEdge(id)) continue;
      graph.addEdge({
        id,
        type: "FLOWS_TO",
        fromNodeId: functionNodeId(sourceFn.id),
        toNodeId: functionNodeId(sinkFn.id),
        certainty,
        data: {
          sourceKind: sourceMatches[0]!.taintKind as TaintSourceKind,
          sinkKind: sinkMatches[0]!.taintKind as TaintSinkKind,
          sourceSignatures: sourceMatches.map((s) => s.name),
          sinkSignatures: sinkMatches.map((s) => s.name),
          sanitized,
        },
      });
    }
  }

  return graph;
}
