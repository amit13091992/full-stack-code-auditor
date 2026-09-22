// Same shape as the positive fixture, but the tainted value is passed through a recognized
// sanitizer (`parseInt`) before reaching the SQL sink. Per the analyzer's own documented
// behavior (packages/analyzers/src/security/sql-injection.ts), sanitizer recognition is a
// named-function heuristic, not a formal proof, so this must still produce a finding -
// downgraded to "low" severity/confidence, not suppressed.
import type { Request, Response } from "express";

export function getUserById(req: Request, res: Response, db: any): void {
  const id = parseInt(req.query.id.toString());
  runQuery(id, db);
  res.send("ok");
}

function runQuery(id: number, db: any): void {
  db.query(id);
}
