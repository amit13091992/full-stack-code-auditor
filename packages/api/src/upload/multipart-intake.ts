import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import type { ApiLimits } from "../config/limits.js";
import { safeExtractZip, ZipExtractionError } from "./zip-extract.js";

export class UploadIntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadIntakeError";
  }
}

function isZipUpload(part: MultipartFile): boolean {
  return part.mimetype === "application/zip" || part.filename.toLowerCase().endsWith(".zip");
}

/** Rejects a target path resolving outside `destRoot` — same guard the zip extractor uses. */
function resolveSafePath(destRoot: string, relativeName: string): string {
  const normalized = relativeName.replace(/\\/g, "/");
  const resolved = path.resolve(destRoot, normalized);
  const relative = path.relative(destRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UploadIntakeError(`Uploaded file name "${relativeName}" resolves outside the workspace root — rejected.`);
  }
  return resolved;
}

/**
 * Streams a single uploaded multipart part into `destRoot`. A `.zip`/`application/zip` part is
 * extracted via `safeExtractZip` (through a temp file, since zip requires seekable input); any
 * other part is written as a single raw file, still subject to the same path-traversal guard.
 * Enforces `limits.maxUploadBytes` against the raw part stream regardless of which path is taken.
 */
export async function intakeMultipartFile(part: MultipartFile, destRoot: string, limits: ApiLimits): Promise<void> {
  if (isZipUpload(part)) {
    const tempZipPath = path.join(destRoot, ".upload.zip");
    let bytesWritten = 0;
    part.file.on("data", (chunk: Buffer) => {
      bytesWritten += chunk.length;
      if (bytesWritten > limits.maxUploadBytes) {
        part.file.destroy(new UploadIntakeError(`Upload exceeds the maximum allowed size (${limits.maxUploadBytes} bytes).`));
      }
    });

    try {
      await pipeline(part.file, createWriteStream(tempZipPath));
      if (part.file.truncated) {
        throw new UploadIntakeError(`Upload exceeds the maximum allowed size (${limits.maxUploadBytes} bytes).`);
      }
      await safeExtractZip(tempZipPath, destRoot, limits);
    } finally {
      await fs.rm(tempZipPath, { force: true });
    }
    return;
  }

  const targetPath = resolveSafePath(destRoot, part.filename);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  let bytesWritten = 0;
  part.file.on("data", (chunk: Buffer) => {
    bytesWritten += chunk.length;
    if (bytesWritten > limits.maxUploadBytes) {
      part.file.destroy(new UploadIntakeError(`Upload exceeds the maximum allowed size (${limits.maxUploadBytes} bytes).`));
    }
  });
  await pipeline(part.file, createWriteStream(targetPath));
  if (part.file.truncated) {
    throw new UploadIntakeError(`Upload exceeds the maximum allowed size (${limits.maxUploadBytes} bytes).`);
  }
}

export { ZipExtractionError };
