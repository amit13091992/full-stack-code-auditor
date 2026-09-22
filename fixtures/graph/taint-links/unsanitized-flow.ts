// Direct source -> sink flow, same function, no sanitizer call in between.
export function handleUnsanitized(req: any, db: any): void {
  const id = req.query.id.toString();
  db.query(id);
}
