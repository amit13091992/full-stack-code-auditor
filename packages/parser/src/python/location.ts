import type Parser from "tree-sitter";
import type { FileId, SourceLocation, SourcePosition, SourceRange } from "@code-analyzer/core";

/**
 * IMPORTANT (parser-engineer review, ADR-0009): `node.startIndex`/`endIndex` from the `tree-sitter`
 * npm binding are **UTF-16 code-unit offsets**, matching native JS string indexing (`.slice`,
 * `.length`) — NOT raw UTF-8 byte offsets, despite the underlying C Tree-sitter library
 * documenting `startIndex` as a byte offset. This holds specifically because `parse-python-file.ts`
 * always calls `parser.parse(content)` with a JS `string`, never a `Buffer`. Verified empirically
 * against a fixture containing non-ASCII (emoji + CJK) text — see
 * `tests/parser/parse-python-file.test.ts`'s non-ASCII regression test. If this code is ever
 * changed to feed Tree-sitter a `Buffer`/byte-oriented input instead of a string (e.g. for
 * streaming or performance reasons), this offset/position mapping would silently become wrong for
 * any non-ASCII file — re-verify this assumption before making that change (ADR-0004: uncertainty
 * about implicit external-library behavior must stay visible, not hidden).
 */
function toPosition(point: { row: number; column: number }, offset: number): SourcePosition {
  return { offset, line: point.row, column: point.column };
}

export function toRange(node: Parser.SyntaxNode): SourceRange {
  return { start: toPosition(node.startPosition, node.startIndex), end: toPosition(node.endPosition, node.endIndex) };
}

export function toLocation(fileId: FileId, path: string, node: Parser.SyntaxNode): SourceLocation {
  return { fileId, path, range: toRange(node) };
}
