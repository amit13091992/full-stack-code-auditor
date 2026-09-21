import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import type { ApiLimits } from "../config/limits.js";

export class ZipExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipExtractionError";
  }
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(new ZipExtractionError(`Not a valid zip archive: ${err?.message ?? "unknown error"}`));
        return;
      }
      resolve(zipFile);
    });
  });
}

function openEntryStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(new ZipExtractionError(`Failed to read zip entry "${entry.fileName}": ${err?.message ?? "unknown error"}`));
        return;
      }
      resolve(stream);
    });
  });
}

/** Rejects any entry whose resolved path would escape `destRoot` — the zip-slip guard. */
function resolveSafeEntryPath(destRoot: string, entryName: string): string | undefined {
  const normalized = entryName.replace(/\\/g, "/");
  const resolved = path.resolve(destRoot, normalized);
  const relative = path.relative(destRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return resolved;
}

/**
 * Streams a zip archive's entries into `destRoot` one at a time, guarding against zip-slip (path
 * traversal), zip bombs (per-entry and total uncompressed-size caps, checked against both the
 * archive's declared sizes and actual bytes written), oversized entry counts, and symlinks (skipped
 * entirely — never materialized from untrusted content). Requires a seekable file on disk (the zip
 * central directory lives at the end of the file), so the caller writes the upload to a temp file
 * before calling this.
 */
export async function safeExtractZip(zipPath: string, destRoot: string, limits: ApiLimits): Promise<void> {
  const zipFile = await openZip(zipPath);
  let entryCount = 0;
  let totalUncompressedBytes = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error instanceof ZipExtractionError ? error : new ZipExtractionError(error.message));
      };
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      zipFile.on("error", fail);
      zipFile.on("end", finish);

      zipFile.on("entry", (entry: yauzl.Entry) => {
        void (async (): Promise<void> => {
          entryCount += 1;
          if (entryCount > limits.maxEntryCount) {
            throw new ZipExtractionError(`Archive exceeds the maximum entry count (${limits.maxEntryCount}).`);
          }

          const isDirectory = /\/$/.test(entry.fileName);
          // Bit 3 (0x0800) of the general-purpose external attributes' upper 16 bits marks a symlink
          // under the Unix external-attribute convention — never followed or materialized.
          const isSymlink = ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;

          if (entry.uncompressedSize > limits.maxEntryBytes) {
            throw new ZipExtractionError(
              `Zip entry "${entry.fileName}" declares ${entry.uncompressedSize} bytes, exceeding the per-entry limit (${limits.maxEntryBytes}).`,
            );
          }
          totalUncompressedBytes += entry.uncompressedSize;
          if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
            throw new ZipExtractionError(
              `Archive's total uncompressed size exceeds the limit (${limits.maxTotalUncompressedBytes} bytes) — possible zip bomb.`,
            );
          }

          const safePath = resolveSafeEntryPath(destRoot, entry.fileName);
          if (!safePath) {
            throw new ZipExtractionError(`Zip entry "${entry.fileName}" resolves outside the extraction root — rejected.`);
          }

          if (isDirectory) {
            await fs.mkdir(safePath, { recursive: true });
          } else if (isSymlink) {
            // Skipped, not extracted — never create a symlink from untrusted archive content.
          } else {
            await fs.mkdir(path.dirname(safePath), { recursive: true });
            const stream = await openEntryStream(zipFile, entry);
            let bytesWritten = 0;
            stream.on("data", (chunk: Buffer) => {
              bytesWritten += chunk.length;
              if (bytesWritten > limits.maxEntryBytes) {
                stream.destroy(new ZipExtractionError(`Zip entry "${entry.fileName}" exceeded its declared size while extracting.`));
              }
            });
            await pipeline(stream, createWriteStream(safePath));
          }
        })().then(
          () => zipFile.readEntry(),
          (error: unknown) => fail(error instanceof Error ? error : new ZipExtractionError(String(error))),
        );
      });

      zipFile.readEntry();
    });
  } finally {
    zipFile.close();
  }
}
