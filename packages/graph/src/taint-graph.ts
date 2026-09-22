import type {
  CallSite,
  EdgeCertainty,
  FunctionEntity,
  Graph,
  TaintFlowEdgeData,
  TaintSinkKind,
  TaintSourceKind,
} from "@code-analyzer/core";
import { InMemoryGraph } from "./in-memory-graph.js";
import { edgeId, functionNodeId } from "./node-ids.js";
import { TAINT_SIGNATURES, matchesCallSite, type TaintSignature } from "./taint-signatures.js";

export type { TaintFlowEdgeData } from "@code-analyzer/core";

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

interface TaintMatch {
  readonly signature: TaintSignature;
  readonly site: CallSite;
}

interface FunctionTaintMatches {
  readonly sources: readonly TaintMatch[];
  readonly sinks: readonly TaintMatch[];
  readonly sanitizers: readonly TaintMatch[];
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
  const sources: TaintMatch[] = [];
  const sinks: TaintMatch[] = [];
  const sanitizers: TaintMatch[] = [];
  for (const site of fn.calls) {
    for (const signature of TAINT_SIGNATURES) {
      if (!matchesCallSite(site, signature.match)) continue;
      if (signature.kind === "source") sources.push({ signature, site });
      else if (signature.kind === "sink") sinks.push({ signature, site });
      else sanitizers.push({ signature, site });
    }
  }
  return { sources, sinks, sanitizers };
}

/**
 * `CallSite.location.range.end.offset` if present — the point at which a call site has fully
 * evaluated, used (not `range.start.offset`) specifically so a sanitizer call that *wraps* its
 * source argument (e.g. `parseInt(req.query.id.toString())`, the common real-world shape, where
 * the sanitizer's own start offset is textually *before* the nested source call's start offset)
 * still orders after the source it wraps: the sanitizer only finishes evaluating once its
 * argument — the source call — has. This is the only reliable program-order signal available from
 * parsed data (Section 7/ADR-0004: don't guess order from anything weaker, e.g. array position
 * alone isn't documented as ordering-guaranteed and hand-built-fixture test data without a `range`
 * must not silently be treated as ordered).
 */
function orderOffset(site: CallSite): number | undefined {
  return site.location.range?.end.offset;
}

/**
 * Same-function sanitizer detection (fix for the unsound "any sanitizer call anywhere in the
 * function" check): only true if a recognized sanitizer call site's position is demonstrably
 * between a source call site and a sink call site, by comparing actual source offsets. If offsets
 * aren't available for a given source/sink/sanitizer triple, that triple contributes no evidence
 * of sanitization — fail toward `false` (unsanitized / critical), never guess (ADR-0004, and this
 * analyzer's documented philosophy of never suppressing a plausible finding).
 */
function hasOrderedSanitizer(
  sources: readonly TaintMatch[],
  sinks: readonly TaintMatch[],
  sanitizers: readonly TaintMatch[],
): boolean {
  if (sanitizers.length === 0) return false;
  for (const source of sources) {
    const sourceOffset = orderOffset(source.site);
    if (sourceOffset === undefined) continue;
    for (const sink of sinks) {
      const sinkOffset = orderOffset(sink.site);
      if (sinkOffset === undefined) continue;
      const [lo, hi] = sourceOffset <= sinkOffset ? [sourceOffset, sinkOffset] : [sinkOffset, sourceOffset];
      for (const sanitizer of sanitizers) {
        const sanitizerOffset = orderOffset(sanitizer.site);
        if (sanitizerOffset === undefined) continue;
        if (sanitizerOffset > lo && sanitizerOffset < hi) return true;
      }
    }
  }
  return false;
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
        const sanitizers = matchesByFunction.get(sourceFn.id as string)!.sanitizers;
        sanitized = hasOrderedSanitizer(sourceMatches, sinkMatches, sanitizers);
      } else {
        const paths = callGraph.findPaths(functionNodeId(sourceFn.id), functionNodeId(sinkFn.id));
        if (paths.length === 0) continue;
        const path = paths[0]!;
        certainty = weakestCertainty(path.edges.map((e) => e.certainty));
        // Cross-function case: unlike the same-function case above, there is no reliable way to
        // order a sanitizer call in one function against a source/sink call site in another
        // function from `CallSite.location` alone (no shared program-order axis across functions).
        // Architecture review finding 2 asked whether this also incorrectly checks the source/sink
        // functions themselves — it deliberately still does: a sanitizer call in the *source*
        // function (the common "sanitize the value, then pass it to a helper that queries the DB"
        // shape, e.g. `fixtures/analyzers/security/sql-injection/sanitized/handler.ts`) is a real,
        // intended signal, not a false one. This is a strictly weaker, path-presence-only signal
        // than the ordered same-function check (it can't rule out an unrelated sanitizer call in
        // the source/sink function the way ordering can within one function), and is documented as
        // such — not silently equated with the stronger same-function guarantee.
        const pathFunctions = path.nodes.filter((n) => n.type === "function");
        sanitized = pathFunctions.some((n) => {
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
          sourceKind: sourceMatches[0]!.signature.taintKind as TaintSourceKind,
          sinkKind: sinkMatches[0]!.signature.taintKind as TaintSinkKind,
          sourceSignatures: sourceMatches.map((s) => s.signature.name),
          sinkSignatures: sinkMatches.map((s) => s.signature.name),
          sanitized,
        },
      });
    }
  }

  return graph;
}
