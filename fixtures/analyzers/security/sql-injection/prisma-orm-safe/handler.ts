// False-positive guard: req.query flows into an ordinary, parameterized Prisma CRUD call
// (`prisma.user.findMany(...)`). This is NOT a recognized sink shape
// (packages/graph/src/taint-signatures.ts deliberately excludes ordinary Prisma CRUD methods --
// they are parameterized by the ORM and not SQL-injectable in normal usage). Expect zero findings.
import type { Request, Response } from "express";

export function listUsersByFilter(req: Request, res: Response, prisma: any): void {
  const id = req.query.id.toString();
  runFindMany(id, prisma);
  res.send("ok");
}

function runFindMany(id: string, prisma: any): void {
  prisma.user.findMany({ where: { id } });
}
