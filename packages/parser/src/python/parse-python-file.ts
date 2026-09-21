import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import type {
  ClassEntity,
  ClassId,
  ClassProperty,
  Diagnostic,
  FileId,
  FunctionEntity,
  FunctionFlavor,
  FunctionId,
  ImportBinding,
  Module,
  Parameter,
  Symbol as SymbolEntity,
  SymbolId,
  SymbolKind,
  Visibility,
} from "@code-analyzer/core";
import { ParseError } from "@code-analyzer/core";
import { toClassId, toFunctionId, toModuleId, toSymbolId } from "../ids.js";
import { toLocation } from "./location.js";

export interface ParsePythonFileResult {
  readonly module: Module;
  readonly symbols: readonly SymbolEntity[];
  readonly functions: readonly FunctionEntity[];
  readonly classes: readonly ClassEntity[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Python's convention for "not part of the public API" — a leading underscore, except dunders (`__init__`, `__repr__`, ...) which are still public protocol methods. */
function isPrivateName(name: string): boolean {
  return name.startsWith("_") && !(name.startsWith("__") && name.endsWith("__"));
}

/**
 * Parses one Python file with Tree-sitter (ADR-0009 — the documented fallback ADR-0006 reserved
 * for a language with no TypeScript-Compiler-API equivalent). Mirrors `parseFile`'s scope as
 * closely as Python's grammar allows: top-level `def`/`class` only, per-file only (no cross-file
 * resolution — same Module Graph responsibility as JS/TS), same deterministic-ID discipline, same
 * "never throws on a syntax error" tolerance (Tree-sitter always returns a best-effort tree; a
 * `hasError` tree becomes a `Diagnostic`, not an exception).
 *
 * Python has no `export` statement, so `Symbol.exported` is derived from the leading-underscore
 * naming convention instead of a keyword — see ADR-0009's Consequences for what this means for
 * consumers of `Symbol.exported`.
 */
export function parsePythonFile(params: { fileId: FileId; path: string; content: string }): ParsePythonFileResult {
  const { fileId, path, content } = params;
  const moduleId = toModuleId(path);

  const parser = new Parser();
  parser.setLanguage(Python as Parser.Language);
  const tree = parser.parse(content);
  const root = tree.rootNode;

  const diagnostics: Diagnostic[] = [];
  if (root.hasError) {
    const parseError = new ParseError("Python source contains a syntax error", path);
    diagnostics.push({ code: parseError.code, severity: "error", message: parseError.message, source: "parser", filePath: path });
  }

  const symbols: SymbolEntity[] = [];
  const functions: FunctionEntity[] = [];
  const classes: ClassEntity[] = [];
  const imports: ImportBinding[] = [];
  const localSymbolIdByName = new Map<string, SymbolId>();

  function addSymbol(kind: SymbolKind, name: string, node: Parser.SyntaxNode, exported: boolean): SymbolId {
    const id = toSymbolId(path, kind, name, node.startIndex);
    const visibility: Visibility = exported ? "public" : "internal";
    symbols.push({ id, name, kind, moduleId, declarationLocation: toLocation(fileId, path, node), visibility, exported });
    localSymbolIdByName.set(name, id);
    return id;
  }

  function extractParameters(paramsNode: Parser.SyntaxNode | null): readonly Parameter[] {
    if (!paramsNode) return [];
    const result: Parameter[] = [];
    for (const p of paramsNode.namedChildren) {
      if (p.type === "identifier") {
        result.push({ name: p.text, optional: false });
      } else if (p.type === "default_parameter" || p.type === "typed_default_parameter") {
        const nameNode = p.childForFieldName("name");
        const valueNode = p.childForFieldName("value");
        const typeNode = p.childForFieldName("type");
        result.push({
          name: nameNode?.text ?? p.text,
          ...(typeNode ? { typeText: typeNode.text } : {}),
          optional: true,
          ...(valueNode ? { defaultValueText: valueNode.text } : {}),
        });
      } else if (p.type === "typed_parameter") {
        const typeNode = p.childForFieldName("type");
        const nameNode = p.namedChildren.find((c) => c.type === "identifier");
        result.push({ name: nameNode?.text ?? p.text, ...(typeNode ? { typeText: typeNode.text } : {}), optional: false });
      } else if (p.type === "list_splat_pattern" || p.type === "dictionary_splat_pattern") {
        result.push({ name: p.text, optional: true });
      }
      // "self"/"cls" aren't special-cased — they're ordinary parameters at this phase's scope.
    }
    return result;
  }

  function decoratorsOf(node: Parser.SyntaxNode): readonly string[] {
    const parent = node.parent;
    if (!parent || parent.type !== "decorated_definition") return [];
    return parent.namedChildren.filter((c) => c.type === "decorator").map((c) => c.text);
  }

  function buildFunctionEntity(node: Parser.SyntaxNode, name: string, flavor: FunctionFlavor, symbolId: SymbolId, exported: boolean, ownerClassId?: ClassId): FunctionEntity {
    const isAsync = node.children[0]?.type === "async";
    const paramsNode = node.childForFieldName("parameters");
    const returnTypeNode = node.childForFieldName("return_type");
    return {
      id: toFunctionId(path, name, node.startIndex),
      symbolId,
      moduleId,
      ...(ownerClassId ? { ownerClassId } : {}),
      name,
      flavor,
      parameters: extractParameters(paramsNode),
      ...(returnTypeNode ? { returnTypeText: returnTypeNode.text } : {}),
      isAsync,
      // Python generators (a `def` containing `yield`) aren't distinguished from ordinary
      // functions in this phase — would need a body scan; not in ADR-0009's scope.
      isGenerator: false,
      isExported: exported,
      location: toLocation(fileId, path, node),
      // Call-site extraction is JS/TS-only this phase (`docs/tasks/phase-4-call-graph.md`) — an
      // empty array here is a truthful "not collected", matching how it's set for every Python
      // function, not a guess about the function's real call behavior.
      calls: [],
    };
  }

  function visitFunctionDef(node: Parser.SyntaxNode, ownerClassId?: ClassId): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = nameNode.text;
    // A method's exposure follows its own name (not its class's) — same convention as module level.
    const exported = !isPrivateName(name);
    const flavor: FunctionFlavor = ownerClassId ? (name === "__init__" ? "constructor" : "method") : "function-declaration";
    const symbolId = ownerClassId ? toSymbolId(path, "method", name, node.startIndex) : addSymbol("function", name, node, exported);
    functions.push(buildFunctionEntity(node, name, flavor, symbolId, exported, ownerClassId));
  }

  function visitClassDef(node: Parser.SyntaxNode): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = nameNode.text;
    const exported = !isPrivateName(name);
    const symbolId = addSymbol("class", name, node, exported);
    const classId = toClassId(path, name, node.startIndex);

    // Python has no separate "implements" concept — every base class is a superclass. The first
    // resolvable base becomes `extendsSymbolId` (matching the JS/TS single-inheritance shape);
    // any further bases (Python supports real multiple inheritance) go into `implementsSymbolIds`
    // as the closest existing field, not a claim they're interfaces.
    let extendsSymbolId: SymbolId | undefined;
    const implementsSymbolIds: SymbolId[] = [];
    const superclasses = node.childForFieldName("superclasses");
    if (superclasses) {
      const bases = superclasses.namedChildren.filter((c) => c.type === "identifier");
      const [first, ...rest] = bases;
      if (first) {
        const resolved = localSymbolIdByName.get(first.text); // same-file only (ADR-0006/0009)
        if (resolved) extendsSymbolId = resolved;
      }
      for (const base of rest) {
        const resolved = localSymbolIdByName.get(base.text);
        if (resolved) implementsSymbolIds.push(resolved);
      }
    }

    const methods: FunctionId[] = [];
    const properties: ClassProperty[] = [];
    const body = node.childForFieldName("body");
    for (const member of body?.namedChildren ?? []) {
      const actual = member.type === "decorated_definition" ? member.namedChildren.find((c) => c.type === "function_definition") : member.type === "function_definition" ? member : undefined;
      if (!actual) continue; // nested classes / class-body assignments (Python's closest thing to properties) are out of scope (ADR-0009)
      const beforeCount = functions.length;
      visitFunctionDef(actual, classId);
      if (functions.length > beforeCount) methods.push(functions[functions.length - 1]!.id);
    }

    classes.push({
      id: classId,
      symbolId,
      moduleId,
      name,
      isAbstract: false, // Python has no `abstract` keyword; ABC-based abstractness isn't syntactic
      isExported: exported,
      ...(extendsSymbolId ? { extendsSymbolId } : {}),
      implementsSymbolIds,
      methods,
      properties,
      decorators: decoratorsOf(node),
      location: toLocation(fileId, path, node),
    });
  }

  function visitImportStatement(node: Parser.SyntaxNode): void {
    // `import a.b.c` / `import a.b.c as x` / `import a, b`
    for (const child of node.namedChildren) {
      if (child.type === "dotted_name") {
        const specifier = child.text;
        imports.push({ fileId, specifier, kind: "namespace", localName: specifier.split(".")[0]!, location: toLocation(fileId, path, child) });
      } else if (child.type === "aliased_import") {
        const nameNode = child.childForFieldName("name");
        const aliasNode = child.childForFieldName("alias");
        if (!nameNode || !aliasNode) continue;
        imports.push({ fileId, specifier: nameNode.text, kind: "namespace", localName: aliasNode.text, location: toLocation(fileId, path, child) });
      }
    }
  }

  function visitImportFromStatement(node: Parser.SyntaxNode): void {
    const moduleNode = node.childForFieldName("module_name");
    const relativeNode = node.namedChildren.find((c) => c.type === "relative_import");
    const specifier = moduleNode ? moduleNode.text : relativeNode ? relativeNode.text : undefined;
    if (specifier === undefined) return;

    const wildcard = node.namedChildren.find((c) => c.type === "wildcard_import");
    if (wildcard) {
      imports.push({ fileId, specifier, kind: "namespace", localName: "*", location: toLocation(fileId, path, node) });
      return;
    }

    for (const child of node.namedChildren) {
      if (child === moduleNode || child.type === "relative_import") continue;
      if (child.type === "dotted_name") {
        imports.push({ fileId, specifier, kind: "named", importedName: child.text, localName: child.text, location: toLocation(fileId, path, child) });
      } else if (child.type === "aliased_import") {
        const nameNode = child.childForFieldName("name");
        const aliasNode = child.childForFieldName("alias");
        if (!nameNode || !aliasNode) continue;
        imports.push({ fileId, specifier, kind: "named", importedName: nameNode.text, localName: aliasNode.text, location: toLocation(fileId, path, child) });
      }
    }
  }

  function visitTopLevelAssignment(node: Parser.SyntaxNode): void {
    const assignment = node.namedChildren[0];
    if (!assignment || assignment.type !== "assignment") return;
    const left = assignment.childForFieldName("left");
    if (!left || left.type !== "identifier") return; // tuple/attribute assignment targets aren't tracked (Phase scope)
    const name = left.text;
    addSymbol("variable", name, node, !isPrivateName(name));
  }

  function visitTopLevelStatement(node: Parser.SyntaxNode): void {
    if (node.type === "function_definition") {
      visitFunctionDef(node);
    } else if (node.type === "class_definition") {
      visitClassDef(node);
    } else if (node.type === "decorated_definition") {
      const actual = node.namedChildren.find((c) => c.type === "function_definition" || c.type === "class_definition");
      if (actual?.type === "function_definition") visitFunctionDef(actual);
      else if (actual?.type === "class_definition") visitClassDef(actual);
    } else if (node.type === "import_statement") {
      visitImportStatement(node);
    } else if (node.type === "import_from_statement") {
      visitImportFromStatement(node);
    } else if (node.type === "expression_statement") {
      visitTopLevelAssignment(node);
    }
  }

  for (const statement of root.namedChildren) {
    visitTopLevelStatement(statement);
  }

  const module: Module = {
    id: moduleId,
    fileId,
    imports,
    exports: [], // Python has no export statement — Symbol.exported (naming convention) carries this instead
    declaredSymbols: symbols.map((s) => s.id),
  };

  return { module, symbols, functions, classes, diagnostics };
}
