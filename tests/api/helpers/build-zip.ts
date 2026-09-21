import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";

export interface ZipEntrySpec {
  readonly path: string;
  readonly content: string | Buffer;
}

/** Builds a real zip file at `destPath` from in-memory entries — used to test the real yauzl-based extractor. */
export async function buildZip(destPath: string, entries: readonly ZipEntrySpec[]): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    zip.addBuffer(Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf-8"), entry.path);
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(destPath));
}
