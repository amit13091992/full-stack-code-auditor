import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../../packages/api/src/config/limits.js";
import { safeExtractZip, ZipExtractionError } from "../../packages/api/src/upload/zip-extract.js";
import { buildZip } from "./helpers/build-zip.js";
import { buildRawZip } from "./helpers/build-raw-zip.js";

let scratchDir: string;
let destRoot: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-analyzer-api-zip-test-"));
  destRoot = path.join(scratchDir, "dest");
  await fs.mkdir(destRoot);
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

describe("safeExtractZip", () => {
  it("extracts a valid small zip's files and directories correctly", async () => {
    const zipPath = path.join(scratchDir, "valid.zip");
    await buildZip(zipPath, [
      { path: "src/index.ts", content: "export const x = 1;\n" },
      { path: "src/nested/util.ts", content: "export const y = 2;\n" },
      { path: "README.md", content: "# fixture\n" },
    ]);

    await safeExtractZip(zipPath, destRoot, DEFAULT_LIMITS);

    expect(await fs.readFile(path.join(destRoot, "src/index.ts"), "utf-8")).toBe("export const x = 1;\n");
    expect(await fs.readFile(path.join(destRoot, "src/nested/util.ts"), "utf-8")).toBe("export const y = 2;\n");
    expect(await fs.readFile(path.join(destRoot, "README.md"), "utf-8")).toBe("# fixture\n");
  });

  it("rejects an entry whose path escapes the extraction root (zip-slip)", async () => {
    const zipPath = path.join(scratchDir, "traversal.zip");
    await buildRawZip(zipPath, [{ name: "../../etc/evil.txt", content: "pwned" }]);

    await expect(safeExtractZip(zipPath, destRoot, DEFAULT_LIMITS)).rejects.toBeInstanceOf(ZipExtractionError);
    await expect(fs.access(path.join(scratchDir, "../etc/evil.txt"))).rejects.toThrow();
  });

  it("rejects an entry declaring more than the per-entry size limit", async () => {
    const zipPath = path.join(scratchDir, "big-entry.zip");
    const oversized = Buffer.alloc(1024, "a");
    await buildZip(zipPath, [{ path: "big.txt", content: oversized }]);

    const tinyLimits = { ...DEFAULT_LIMITS, maxEntryBytes: 100 };
    await expect(safeExtractZip(zipPath, destRoot, tinyLimits)).rejects.toBeInstanceOf(ZipExtractionError);
  });

  it("rejects an archive whose total uncompressed size exceeds the zip-bomb ceiling", async () => {
    const zipPath = path.join(scratchDir, "many-entries.zip");
    const entries = Array.from({ length: 5 }, (_, i) => ({ path: `file-${i}.txt`, content: Buffer.alloc(200, "a") }));
    await buildZip(zipPath, entries);

    const tinyLimits = { ...DEFAULT_LIMITS, maxEntryBytes: 1000, maxTotalUncompressedBytes: 500 };
    await expect(safeExtractZip(zipPath, destRoot, tinyLimits)).rejects.toBeInstanceOf(ZipExtractionError);
  });

  it("rejects an archive with more entries than the configured cap", async () => {
    const zipPath = path.join(scratchDir, "entry-count.zip");
    const entries = Array.from({ length: 10 }, (_, i) => ({ path: `file-${i}.txt`, content: "x" }));
    await buildZip(zipPath, entries);

    const tinyLimits = { ...DEFAULT_LIMITS, maxEntryCount: 3 };
    await expect(safeExtractZip(zipPath, destRoot, tinyLimits)).rejects.toBeInstanceOf(ZipExtractionError);
  });

  it("rejects a file that is not a valid zip archive", async () => {
    const notAZip = path.join(scratchDir, "not-a-zip.zip");
    await fs.writeFile(notAZip, "this is definitely not a zip file");

    await expect(safeExtractZip(notAZip, destRoot, DEFAULT_LIMITS)).rejects.toBeInstanceOf(ZipExtractionError);
  });
});
