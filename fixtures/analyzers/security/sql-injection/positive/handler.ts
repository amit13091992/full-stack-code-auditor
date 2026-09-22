// Real Express-style handler: req.query flows unsanitized into a db-client-shaped `.query(...)`
// call. Matches TAINT_SIGNATURES's "req.query" source and "db-client.query" sink
// (packages/graph/src/taint-signatures.ts) end-to-end through the real parser -> Call Graph ->
// Taint Graph -> sqlInjectionAnalyzer pipeline. Expect exactly one critical-severity finding.
import type { Request, Response } from "express";

export function getUserById(req: Request, res: Response, db: any): void {
  const id = req.query.id.toString();
  runQuery(id, db);
  res.send("ok");
}

function runQuery(id: string, db: any): void {
  db.query(id);
}
