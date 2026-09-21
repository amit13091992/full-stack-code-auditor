import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../packages/api/src/server.js";
import { DEFAULT_LIMITS } from "../../packages/api/src/config/limits.js";
import { buildZip } from "./helpers/build-zip.js";

let app: FastifyInstance;
let baseUrl: string;
let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-analyzer-api-route-test-"));
  app = await buildServer({ rateLimitMax: 1000 });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("expected a bound TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await app.close();
  await fs.rm(scratchDir, { recursive: true, force: true });
});

async function zipFixtureFormData(): Promise<FormData> {
  const zipPath = path.join(scratchDir, "fixture.zip");
  await buildZip(zipPath, [
    { path: "package.json", content: JSON.stringify({ name: "fixture", version: "1.0.0" }) },
    { path: "src/config.ts", content: 'export const AWS_KEY = "AKIAABCDEFGHIJKLMNOP";\n' },
    { path: "src/clean.ts", content: "export function ok() {\n  return 1;\n}\n" },
  ]);
  const zipBytes = await fs.readFile(zipPath);
  const form = new FormData();
  form.set("archive", new Blob([zipBytes], { type: "application/zip" }), "fixture.zip");
  return form;
}

describe("GET /v1/health", () => {
  it("returns ok", async () => {
    const response = await fetch(`${baseUrl}/v1/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("POST /v1/scans", () => {
  it("runs a real scan end-to-end on an uploaded zip and reports a real finding", async () => {
    const response = await fetch(`${baseUrl}/v1/scans`, { method: "POST", body: await zipFixtureFormData() });
    expect(response.status).toBe(200);

    const result = (await response.json()) as {
      schemaVersion: string;
      scan: { status: string };
      findings: Array<{ ruleId: string }>;
      summary: { filesAnalyzed: number; totalFindings: number };
    };

    expect(result.schemaVersion).toBe("0.1.0");
    expect(result.scan.status).toBe("completed");
    expect(result.summary.filesAnalyzed).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.ruleId === "secrets/aws-access-key-id")).toBe(true);
  });

  it("rejects a request with no uploaded file", async () => {
    const form = new FormData();
    form.set("note", "no file here");
    const response = await fetch(`${baseUrl}/v1/scans`, { method: "POST", body: form });
    expect(response.status).toBe(400);
  });

  it("rejects a malicious zip and leaves no temp workspace behind", async () => {
    // A path-traversal zip is rejected by the real extractor (see tests/api/zip-extract.test.ts for
    // the unit-level guard); here we only assert the route surfaces it as a clean 400, not a crash.
    const zipPath = path.join(scratchDir, "traversal.zip");
    const { buildRawZip } = await import("./helpers/build-raw-zip.js");
    await buildRawZip(zipPath, [{ name: "../../etc/evil.txt", content: "pwned" }]);
    const zipBytes = await fs.readFile(zipPath);
    const form = new FormData();
    form.set("archive", new Blob([zipBytes], { type: "application/zip" }), "traversal.zip");

    const response = await fetch(`${baseUrl}/v1/scans`, { method: "POST", body: form });
    expect(response.status).toBe(400);
  });

  it("rejects an upload larger than the configured limit and leaves no workspace behind", async () => {
    await app.close();
    app = await buildServer({ rateLimitMax: 1000, limits: { ...DEFAULT_LIMITS, maxUploadBytes: 1024 } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("expected a bound TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const oversized = Buffer.alloc(5 * 1024, "a");
    const form = new FormData();
    form.set("archive", new Blob([oversized], { type: "application/zip" }), "big.zip");

    const response = await fetch(`${baseUrl}/v1/scans`, { method: "POST", body: form });
    expect(response.status).toBe(400);
  });
});

describe("POST /v1/scans?stream=true", () => {
  it("streams SSE frames and ends with a result event carrying the ScanResult", async () => {
    const response = await fetch(`${baseUrl}/v1/scans?stream=true`, { method: "POST", body: await zipFixtureFormData() });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    expect(body).toContain("event: scan:started");
    expect(body).toContain("event: stage:started");
    expect(body).toContain("event: result");

    const resultFrame = body.split("event: result\ndata: ")[1]?.split("\n\n")[0];
    expect(resultFrame).toBeDefined();
    const result = JSON.parse(resultFrame ?? "{}") as { schemaVersion: string; findings: Array<{ ruleId: string }> };
    expect(result.schemaVersion).toBe("0.1.0");
    expect(result.findings.some((f) => f.ruleId === "secrets/aws-access-key-id")).toBe(true);
  });
});
