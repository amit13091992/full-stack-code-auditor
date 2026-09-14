import ts from "typescript";
import type { FileId, SourceLocation, SourcePosition, SourceRange } from "@code-analyzer/core";

function toPosition(sourceFile: ts.SourceFile, offset: number): SourcePosition {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(offset);
  return { offset, line, column: character };
}

export function toRange(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  return {
    start: toPosition(sourceFile, node.getStart(sourceFile)),
    end: toPosition(sourceFile, node.getEnd()),
  };
}

export function toLocation(fileId: FileId, path: string, sourceFile: ts.SourceFile, node: ts.Node): SourceLocation {
  return { fileId, path, range: toRange(sourceFile, node) };
}
