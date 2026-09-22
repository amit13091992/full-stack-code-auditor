// A recognized taint source (req.query) is read, but the value only ever reaches sinks with no
// TAINT_SIGNATURES entry: a plain console.log and a template `.render()` call (html-render, not
// sql). No recognized SQL sink is ever reached, so this must produce zero
// security/sql-injection findings - proving the analyzer doesn't over-fire on tainted data that
// never touches a SQL-shaped call.
import type { Request, Response } from "express";

export function showUser(req: Request, res: Response, view: any): void {
  const id = req.query.id.toString();
  console.log(id);
  view.render(id);
  res.send("ok");
}
