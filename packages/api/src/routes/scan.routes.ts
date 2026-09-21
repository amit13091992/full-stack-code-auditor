import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import type { ApiLimits } from "../config/limits.js";
import { createTempWorkspace } from "../upload/workspace.js";
import { intakeMultipartFile, UploadIntakeError } from "../upload/multipart-intake.js";
import { ZipExtractionError } from "../upload/zip-extract.js";
import { runScan } from "../scan/run-scan.js";
import { scanEventToSse, writeSseFrame } from "../scan/event-bridge.js";
import type { ApiErrorBody } from "../types.js";

function isMultipartFile(part: unknown): part is MultipartFile {
  return typeof part === "object" && part !== null && (part as { type?: string }).type === "file";
}

async function materializeUpload(request: FastifyRequest, destRoot: string, limits: ApiLimits): Promise<void> {
  let sawFile = false;
  for await (const part of request.parts()) {
    if (!isMultipartFile(part)) continue;
    sawFile = true;
    await intakeMultipartFile(part, destRoot, limits);
  }
  if (!sawFile) {
    throw new UploadIntakeError("No file uploaded — expected a multipart field containing a .zip archive or source files.");
  }
}

function isKnownUploadError(error: unknown): error is UploadIntakeError | ZipExtractionError {
  return error instanceof UploadIntakeError || error instanceof ZipExtractionError;
}

export function registerScanRoutes(app: FastifyInstance, limits: ApiLimits): void {
  app.get("/v1/health", async () => ({ status: "ok" }));

  app.post("/v1/scans", async (request: FastifyRequest, reply: FastifyReply) => {
    const streaming = (request.query as { stream?: string }).stream === "true";
    const workspace = await createTempWorkspace();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), limits.scanTimeoutMs);
    // `reply.raw`'s "close" (not `request.raw`'s — the request stream closes as soon as its body is
    // fully read, well before the response completes) fires when the client actually disconnects
    // mid-response; ignore it once we've already finished writing a response ourselves.
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    try {
      await materializeUpload(request, workspace.root, limits);

      if (!streaming) {
        const result = await runScan({ root: workspace.root, signal: controller.signal });
        return await reply.code(200).send(result);
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const write = (chunk: string): void => {
        reply.raw.write(chunk);
      };

      try {
        const result = await runScan({
          root: workspace.root,
          signal: controller.signal,
          onEvent: (event) => scanEventToSse(write, event),
        });
        writeSseFrame(write, "result", result);
      } catch (error) {
        writeSseFrame(write, "error", { error: error instanceof Error ? error.message : String(error) });
      } finally {
        reply.raw.end();
      }
      return reply;
    } catch (error) {
      // Reached only for upload/intake failures — the streaming path's own scan errors are caught
      // and written as an SSE "error" frame above, after the reply has already been hijacked.
      const status = isKnownUploadError(error) ? 400 : 500;
      const body: ApiErrorBody = { error: error instanceof Error ? error.message : String(error) };
      return await reply.code(status).send(body);
    } finally {
      clearTimeout(timeout);
      await workspace.cleanup();
    }
  });
}
