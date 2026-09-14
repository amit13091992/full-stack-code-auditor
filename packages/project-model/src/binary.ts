import path from "node:path";

const KNOWN_BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".webp",
  ".lockb",
]);

/** Heuristic binary detection: known binary extensions, or a NUL byte in the first 8KB (Section 1). */
export function isBinary(relativePath: string, sample: Buffer): boolean {
  if (KNOWN_BINARY_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) return true;
  const scanLength = Math.min(sample.length, 8000);
  for (let i = 0; i < scanLength; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}
