// Real Express-style handler: req.query flows unsanitized into Prisma's raw-query escape hatch
// `$queryRawUnsafe(...)`. Matches TAINT_SIGNATURES's "req.query" source and
// "prisma.$queryRawUnsafe" sink (packages/graph/src/taint-signatures.ts) end-to-end through the
// real parser -> Call Graph -> Taint Graph -> sqlInjectionAnalyzer pipeline. Expect exactly one
// critical-severity finding.
import type { Request, Response } from "express";

export function getUserByIdRaw(req: Request, res: Response, prisma: any): void {
  const id = req.query.id.toString();
  runRawQuery(id, prisma);
  res.send("ok");
}

function runRawQuery(id: string, prisma: any): void {
  prisma.$queryRawUnsafe("SELECT * FROM User WHERE id = " + id);
}
