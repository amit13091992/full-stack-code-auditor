// A recognized taint source is read, but only ever passed to a safe sink (console.log, which
// matches no TAINT_SIGNATURES sink entry) - no recognized sink is ever reached. The Taint Graph
// must not produce any FLOWS_TO edge here; asserting that is as important as the positive cases
// (docs/testing/strategy.md Section 30).
export function logOnly(req: any): void {
  const id = req.query.id.toString();
  console.log(id);
}
