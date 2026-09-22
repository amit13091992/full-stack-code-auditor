// Regression fixture for the unsound sanitizer-detection bug (architecture + security review,
// 2026-09-22): a recognized sanitizer name (parseInt) is called in this function, but on a value
// unrelated to the tainted req.query.id that actually reaches db.query. This must still be
// reported as sanitized: false — mere co-occurrence of a sanitizer call anywhere in the function
// body is not evidence that the tainted value was ever passed through it.
export function handleUnrelatedSanitizer(req: any, db: any, other: any): void {
  const unrelated = parseInt(other.count);
  const id = req.query.id.toString();
  db.query(id);
  console.log(unrelated);
}
