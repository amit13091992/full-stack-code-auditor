#!/usr/bin/env node
import { buildServer } from "./server.js";
import { sweepOrphanedWorkspaces } from "./upload/workspace.js";

const ORPHAN_SWEEP_MAX_AGE_MS = 6 * 60 * 60 * 1000;

async function main(): Promise<void> {
  await sweepOrphanedWorkspaces(ORPHAN_SWEEP_MAX_AGE_MS);

  const port = Number(process.env["PORT"] ?? 3000);
  const host = process.env["HOST"] ?? "0.0.0.0";

  const app = await buildServer();
  await app.listen({ port, host });
  process.stderr.write(`@code-analyzer/api listening on http://${host}:${port}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
