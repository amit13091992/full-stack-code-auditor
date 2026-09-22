// Same source -> sink flow as unsanitized-flow.ts, but with a recognized sanitizer call
// (parseInt) sitting between the source read and the sink call.
export function handleSanitized(req: any, db: any): void {
  const id = parseInt(req.query.id.toString());
  db.query(id);
}
