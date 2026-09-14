import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FileId } from "../../packages/core/src/index.js";
import { parsePythonFile } from "../../packages/parser/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/parser/python-constructs");

async function parseFixture(name: string) {
  const filePath = path.join(FIXTURES_ROOT, name);
  const content = await fs.readFile(filePath, "utf-8");
  return parsePythonFile({ fileId: name as FileId, path: name, content });
}

describe("parsePythonFile / functions.py", () => {
  it("extracts top-level functions, async functions, and applies the leading-underscore exposure convention", async () => {
    const result = await parseFixture("functions.py");
    expect(result.diagnostics).toHaveLength(0);

    const add = result.functions.find((f) => f.name === "add");
    expect(add?.flavor).toBe("function-declaration");
    expect(add?.isExported).toBe(true);
    expect(add?.isAsync).toBe(false);
    expect(add?.parameters).toEqual([{ name: "a", optional: false }, { name: "b", optional: false }]);

    const fetchFn = result.functions.find((f) => f.name === "fetch");
    expect(fetchFn?.isAsync).toBe(true);
    expect(fetchFn?.parameters).toEqual([
      { name: "url", optional: false },
      { name: "timeout", optional: true, defaultValueText: "5" },
    ]);

    const helper = result.functions.find((f) => f.name === "_helper");
    expect(helper?.isExported).toBe(false); // leading underscore -> not part of the public surface

    const greeting = result.symbols.find((s) => s.name === "GREETING");
    expect(greeting?.kind).toBe("variable");
    expect(greeting?.exported).toBe(true);
    const cache = result.symbols.find((s) => s.name === "_internal_cache");
    expect(cache?.exported).toBe(false);
  });

  it("produces deterministic IDs across repeated parses", async () => {
    const first = await parseFixture("functions.py");
    const second = await parseFixture("functions.py");
    expect(second.functions.map((f) => f.id)).toEqual(first.functions.map((f) => f.id));
  });
});

describe("parsePythonFile / shapes.py", () => {
  it("extracts classes with methods, a decorator, __init__ as constructor, and same-file multiple-inheritance resolution", async () => {
    const result = await parseFixture("shapes.py");
    expect(result.diagnostics).toHaveLength(0);

    const shape = result.classes.find((c) => c.name === "Shape");
    expect(shape).toBeDefined();
    const shapeInit = result.functions.find((f) => f.ownerClassId === shape?.id && f.name === "__init__");
    expect(shapeInit?.flavor).toBe("constructor");
    const describe = result.functions.find((f) => f.ownerClassId === shape?.id && f.name === "describe");
    expect(describe?.flavor).toBe("method");

    const sized = result.classes.find((c) => c.name === "Sized");
    const circle = result.classes.find((c) => c.name === "Circle");
    expect(circle?.decorators).toEqual(["@dataclass"]);
    // class Circle(Shape, Sized): first base -> extendsSymbolId, remaining bases -> implementsSymbolIds.
    expect(circle?.extendsSymbolId).toBe(shape?.symbolId);
    expect(circle?.implementsSymbolIds).toContain(sized?.symbolId);

    const internalHelper = result.classes.find((c) => c.name === "_InternalHelper");
    expect(internalHelper?.isExported).toBe(false);
  });
});

describe("parsePythonFile / imports.py", () => {
  it("extracts import / import-as / from-import / from-import-as / relative / wildcard forms", async () => {
    const result = await parseFixture("imports.py");

    const plainImport = result.module.imports.find((i) => i.specifier === "os");
    expect(plainImport?.kind).toBe("namespace");
    expect(plainImport?.localName).toBe("os");

    const aliasedImport = result.module.imports.find((i) => i.specifier === "numpy");
    expect(aliasedImport?.localName).toBe("np");

    const fromImport = result.module.imports.find((i) => i.specifier === "typing" && i.importedName === "List");
    expect(fromImport?.kind).toBe("named");
    const fromImportAliased = result.module.imports.find((i) => i.specifier === "typing" && i.importedName === "Dict");
    expect(fromImportAliased?.localName).toBe("D");

    const relativeImport = result.module.imports.find((i) => i.specifier === "." && i.importedName === "sibling");
    expect(relativeImport?.kind).toBe("named");
    const relativeModuleImport = result.module.imports.find((i) => i.specifier === ".pkg");
    expect(relativeModuleImport?.importedName).toBe("thing");

    const wildcard = result.module.imports.find((i) => i.specifier === ".pkg.deep");
    expect(wildcard?.kind).toBe("namespace");
    expect(wildcard?.localName).toBe("*");

    // Cross-file resolution is the Module Graph's job (ADR-0006/0009), not the parser's.
    for (const binding of result.module.imports) {
      expect(binding.resolvedModuleId).toBeUndefined();
    }
  });
});

describe("parsePythonFile / non-ascii.py (parser-engineer review regression)", () => {
  it("reports correct line/column and a byte-position-usable offset after non-ASCII (emoji + CJK) content", async () => {
    const content = await fs.readFile(path.join(FIXTURES_ROOT, "non-ascii.py"), "utf-8");
    const result = parsePythonFile({ fileId: "non-ascii.py" as FileId, path: "non-ascii.py", content });
    expect(result.diagnostics).toHaveLength(0);

    const after = result.functions.find((f) => f.name === "after");
    expect(after).toBeDefined();
    // `def after(...)` starts on the 4th line (0-based line 3), column 0 — after a line containing
    // an emoji + CJK string literal and two blank lines.
    expect(after?.location.range?.start.line).toBe(3);
    expect(after?.location.range?.start.column).toBe(0);

    // tree-sitter's `startIndex` (via the `tree-sitter` npm binding, given a JS string input) is a
    // UTF-16 code-unit offset, not a UTF-8 byte offset — so slicing the original JS string at that
    // offset must land exactly on "def", proving IDs/locations built from it stay self-consistent
    // with ordinary JS string indexing even when preceding content is non-ASCII.
    const offset = after?.location.range?.start.offset;
    expect(offset).toBeDefined();
    expect(content.slice(offset!, offset! + 3)).toBe("def");
  });
});

describe("parsePythonFile / malformed.py", () => {
  it("tolerates a syntax error: returns a Diagnostic instead of throwing", async () => {
    const result = await parseFixture("malformed.py");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.source).toBe("parser");
    expect(result.module).toBeDefined();
  });
});
