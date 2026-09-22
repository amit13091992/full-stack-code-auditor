// KNOWN LIMITATION, not a bug: req.query flows into an ORM-style call
// (`userRepository.findOne(...)`) that is a real SQL sink in application terms but does not
// match any entry in TAINT_SIGNATURES's fixed sink table (packages/graph/src/taint-signatures.ts
// only recognizes a `.query(...)` call on a receiver ending in
// db/pool/connection/client/conn - "findOne" on a "Repository"-named receiver is a different,
// unrecognized shape). This is a deliberate first-cut false negative per the signature table's
// stated small scope (docs/tasks/phase-5-taint-graph.md "Known non-goals"), not something this
// analyzer is expected to catch yet. Expect zero findings here.
import type { Request, Response } from "express";

export function getUserByIdOrm(req: Request, res: Response, userRepository: any): void {
  const id = req.query.id.toString();
  userRepository.findOne(id);
  res.send("ok");
}
