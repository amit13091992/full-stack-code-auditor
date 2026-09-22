// Source read in one function, sink call in a callback passed to another function. The Call
// Graph only resolves this as an "unknown" CALLS edge (callback reachability, not a statically
// known invocation order/timing - see call-graph.ts's hasFunctionArgument handling and
// fixtures/graph/call-links/callback-argument.ts, the Phase 4 precedent for this exact shape).
// The Taint Graph must still produce a FLOWS_TO edge here, with that reduced certainty carried
// through, not silently dropped.
export function processRequest(req: any, db: any): void {
  const id = req.query.id.toString();
  run(() => {
    db.query(id);
  });
}

function run(callback: () => void): void {
  callback();
}
