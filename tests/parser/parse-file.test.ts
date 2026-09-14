import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FileId } from "../../packages/core/src/index.js";
import { parseFile } from "../../packages/parser/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/parser/basic-constructs");

async function parseFixture(name: string) {
  const filePath = path.join(FIXTURES_ROOT, name);
  const content = await fs.readFile(filePath, "utf-8");
  return parseFile({ fileId: name as FileId, path: name, content });
}

describe("parseFile / functions.ts", () => {
  it("extracts a function declaration and an arrow function assigned to a const", async () => {
    const result = await parseFixture("functions.ts");

    expect(result.diagnostics).toHaveLength(0);
    expect(result.module.id).toBe("functions.ts");

    const add = result.functions.find((f) => f.name === "add");
    expect(add).toBeDefined();
    expect(add?.flavor).toBe("function-declaration");
    expect(add?.isExported).toBe(true);
    expect(add?.isAsync).toBe(false);
    expect(add?.parameters).toEqual([
      { name: "a", typeText: "number", optional: false },
      { name: "b", typeText: "number", optional: false },
    ]);
    expect(add?.returnTypeText).toBe("number");

    const multiply = result.functions.find((f) => f.name === "multiply");
    expect(multiply?.flavor).toBe("arrow");
    expect(multiply?.isExported).toBe(true);

    const fetchThing = result.functions.find((f) => f.name === "fetchThing");
    expect(fetchThing?.isAsync).toBe(true);
    expect(fetchThing?.isExported).toBe(false);

    // Every function has a backing Symbol, and the module lists all of them as declared symbols.
    for (const fn of [add, multiply, fetchThing]) {
      const symbol = result.symbols.find((s) => s.id === fn?.symbolId);
      expect(symbol).toBeDefined();
      expect(result.module.declaredSymbols).toContain(symbol?.id);
    }
  });

  it("produces deterministic IDs across repeated parses of unchanged content", async () => {
    const first = await parseFixture("functions.ts");
    const second = await parseFixture("functions.ts");
    expect(second.functions.map((f) => f.id)).toEqual(first.functions.map((f) => f.id));
    expect(second.symbols.map((s) => s.id)).toEqual(first.symbols.map((s) => s.id));
  });
});

describe("parseFile / shapes.ts", () => {
  it("extracts an interface, a type alias, and an enum as Symbols", async () => {
    const result = await parseFixture("shapes.ts");
    expect(result.diagnostics).toHaveLength(0);

    const point = result.symbols.find((s) => s.name === "Point");
    expect(point?.kind).toBe("interface");
    expect(point?.exported).toBe(true);

    const coords = result.symbols.find((s) => s.name === "Coordinates");
    expect(coords?.kind).toBe("type-alias");
    expect(coords?.typeText).toBe("[number, number]");

    const direction = result.symbols.find((s) => s.name === "Direction");
    expect(direction?.kind).toBe("enum");
  });

  it("extracts a class with a constructor, method, property, decorator, and same-file inheritance", async () => {
    const result = await parseFixture("shapes.ts");

    const shape = result.classes.find((c) => c.name === "Shape");
    expect(shape).toBeDefined();
    expect(shape?.isAbstract).toBe(true);
    expect(shape?.isExported).toBe(true);
    const idProperty = shape?.properties.find((p) => p.name === "id");
    expect(idProperty?.isReadonly).toBe(true);
    expect(idProperty?.decorators).toEqual(["@readonly"]);
    const colorProperty = shape?.properties.find((p) => p.name === "color");
    expect(colorProperty?.visibility).toBe("protected");

    const shapeConstructor = result.functions.find((f) => f.ownerClassId === shape?.id && f.flavor === "constructor");
    expect(shapeConstructor).toBeDefined();
    const describeMethod = result.functions.find((f) => f.ownerClassId === shape?.id && f.name === "describe");
    expect(describeMethod?.flavor).toBe("method");

    const circle = result.classes.find((c) => c.name === "Circle");
    expect(circle).toBeDefined();
    expect(circle?.isExported).toBe(true);
    // Circle extends Shape, both declared in this same file — resolvable per ADR-0006's per-file scope.
    expect(circle?.extendsSymbolId).toBe(shape?.symbolId);
    // Circle implements both Point and Sized, also declared in this same file.
    const pointSymbol = result.symbols.find((s) => s.name === "Point");
    const sizedSymbol = result.symbols.find((s) => s.name === "Sized");
    expect(circle?.implementsSymbolIds).toContain(pointSymbol?.id);
    expect(circle?.implementsSymbolIds).toContain(sizedSymbol?.id);
    expect(circle?.implementsSymbolIds).toHaveLength(2);

    // Circle.defaultColor is a static property — isStatic must actually distinguish it from
    // instance properties like x/y.
    const defaultColorProperty = circle?.properties.find((p) => p.name === "defaultColor");
    expect(defaultColorProperty?.isStatic).toBe(true);
    const xProperty = circle?.properties.find((p) => p.name === "x");
    expect(xProperty?.isStatic).toBe(false);

    // Circle's `diameter` accessor pair must be tagged with the getter/setter FunctionFlavor
    // (not lumped in with ordinary "method").
    const getter = result.functions.find((f) => f.ownerClassId === circle?.id && f.name === "diameter" && f.flavor === "getter");
    expect(getter).toBeDefined();
    expect(getter?.parameters).toEqual([]);
    const setter = result.functions.find((f) => f.ownerClassId === circle?.id && f.name === "diameter" && f.flavor === "setter");
    expect(setter).toBeDefined();
    expect(setter?.parameters).toEqual([{ name: "value", typeText: "number", optional: false }]);

    // InternalHelper is declared without `export` — isExported must be false, not just omitted.
    const internalHelper = result.classes.find((c) => c.name === "InternalHelper");
    expect(internalHelper).toBeDefined();
    expect(internalHelper?.isExported).toBe(false);
  });
});

describe("parseFile / component.tsx", () => {
  it("parses a TSX file (React component) using the JSX ScriptKind path", async () => {
    const result = await parseFixture("component.tsx");

    // TSX has a distinct parser entry point (ts.ScriptKind.TSX) from plain .ts — a wrong
    // ScriptKind would produce a parse diagnostic on the JSX syntax itself.
    expect(result.diagnostics).toHaveLength(0);

    const greeting = result.functions.find((f) => f.name === "Greeting");
    expect(greeting).toBeDefined();
    expect(greeting?.flavor).toBe("function-declaration");
    expect(greeting?.isExported).toBe(true);
  });
});

describe("parseFile / imports-exports.ts", () => {
  it("extracts default, namespace, named, and side-effect imports", async () => {
    const result = await parseFixture("imports-exports.ts");

    const defaultImport = result.module.imports.find((i) => i.kind === "default");
    expect(defaultImport?.specifier).toBe("./default-target.js");
    expect(defaultImport?.localName).toBe("defaultExport");

    const namespaceImport = result.module.imports.find((i) => i.kind === "namespace");
    expect(namespaceImport?.localName).toBe("ns");

    const namedImports = result.module.imports.filter((i) => i.kind === "named");
    expect(namedImports).toHaveLength(2);
    expect(namedImports.map((i) => i.localName).sort()).toEqual(["named", "renamed"]);
    expect(namedImports.find((i) => i.localName === "renamed")?.importedName).toBe("other");

    const sideEffect = result.module.imports.find((i) => i.kind === "side-effect");
    expect(sideEffect?.specifier).toBe("./side-effect-target.js");

    // Cross-file resolution is explicitly out of scope this phase (ADR-0006).
    for (const binding of result.module.imports) {
      expect(binding.resolvedModuleId).toBeUndefined();
    }
  });

  it("extracts named, default, and re-export exports, plus a dynamic import", async () => {
    const result = await parseFixture("imports-exports.ts");

    const namedExports = result.module.exports.filter((e) => e.kind === "named");
    expect(namedExports.map((e) => e.exportedName).sort()).toEqual(["named", "renamed"]);

    const reExport = result.module.exports.find((e) => e.kind === "re-export");
    expect(reExport?.exportedName).toBe("*");

    const defaultExport = result.module.exports.find((e) => e.kind === "default");
    expect(defaultExport).toBeDefined();

    const dynamicImport = result.module.imports.find((i) => i.kind === "dynamic");
    expect(dynamicImport?.specifier).toBe("./dynamic-target.js");
  });
});

describe("parseFile / plain.js", () => {
  it("parses plain JavaScript (allowJs path) without type annotations", async () => {
    const result = await parseFixture("plain.js");
    expect(result.diagnostics).toHaveLength(0);

    const greet = result.functions.find((f) => f.name === "greet");
    expect(greet?.parameters).toEqual([{ name: "name", optional: false }]);
    expect(greet?.returnTypeText).toBeUndefined();

    const shout = result.functions.find((f) => f.name === "shout");
    expect(shout?.flavor).toBe("arrow");
  });
});

describe("parseFile / commonjs.js", () => {
  it("extracts require() calls as ImportBindings (default, named-destructured, and side-effect)", async () => {
    const result = await parseFixture("commonjs.js");
    expect(result.diagnostics).toHaveLength(0);

    const defaultRequire = result.module.imports.find((i) => i.localName === "express");
    expect(defaultRequire?.kind).toBe("default");
    expect(defaultRequire?.specifier).toBe("express");
    expect(defaultRequire?.resolvedModuleId).toBeUndefined(); // cross-file resolution is the Module Graph's job (ADR-0006)

    const namedRequires = result.module.imports.filter((i) => i.specifier === "./fs-helpers.js");
    expect(namedRequires).toHaveLength(2);
    expect(namedRequires.every((i) => i.kind === "named")).toBe(true);
    expect(namedRequires.find((i) => i.localName === "readFile")?.importedName).toBe("readFile");
    expect(namedRequires.find((i) => i.localName === "saveFile")?.importedName).toBe("writeFile");

    const sideEffect = result.module.imports.find((i) => i.specifier === "./setup-side-effects.js");
    expect(sideEffect?.kind).toBe("side-effect");
  });

  it("extracts module.exports / module.exports.foo / exports.foo as ExportBindings", async () => {
    const result = await parseFixture("commonjs.js");

    const wholeModuleExport = result.module.exports.find((e) => e.kind === "default");
    expect(wholeModuleExport?.exportedName).toBe("default");
    // `module.exports = createServer;` — createServer is a locally declared function, resolved.
    const createServer = result.functions.find((f) => f.name === "createServer");
    expect(wholeModuleExport?.symbolId).toBe(createServer?.symbolId);

    const namedExports = result.module.exports.filter((e) => e.kind === "named").map((e) => e.exportedName).sort();
    expect(namedExports).toEqual(["readFile", "saveFile"]);
  });
});

describe("parseFile / malformed.ts", () => {
  it("tolerates a syntax error: returns a Diagnostic instead of throwing", async () => {
    const result = await parseFixture("malformed.ts");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.source).toBe("parser");
    expect(result.diagnostics[0]?.filePath).toBe("malformed.ts");
    // A best-effort AST still exists — the module/symbol collections are well-formed, just partial.
    expect(result.module).toBeDefined();
  });
});
