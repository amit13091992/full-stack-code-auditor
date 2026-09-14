import ts from "typescript";
import type {
  ClassEntity,
  ClassId,
  ClassProperty,
  Diagnostic,
  ExportBinding,
  ExportKind,
  FileId,
  FunctionEntity,
  FunctionFlavor,
  FunctionId,
  ImportBinding,
  ImportKind,
  Module,
  Parameter,
  Symbol as SymbolEntity,
  SymbolId,
  SymbolKind,
  Visibility,
} from "@code-analyzer/core";
import { ParseError } from "@code-analyzer/core";
import { toClassId, toFunctionId, toModuleId, toSymbolId } from "./ids.js";
import { toLocation } from "./location.js";

export interface ParseFileResult {
  readonly module: Module;
  readonly symbols: readonly SymbolEntity[];
  readonly functions: readonly FunctionEntity[];
  readonly classes: readonly ClassEntity[];
  readonly diagnostics: readonly Diagnostic[];
}

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".cts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false) : false;
}

function decoratorsOf(sourceFile: ts.SourceFile, node: ts.Node): readonly string[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).map((d) => d.getText(sourceFile));
}

function nameOf(node: { name?: ts.PropertyName | ts.BindingName | undefined }): string | undefined {
  const name = node.name;
  return name && ts.isIdentifier(name) ? name.text : undefined;
}

/**
 * Parses one file's content with the TypeScript Compiler API (ADR-0006) into the shared semantic
 * model. Per-file only — cross-file import resolution is Phase 3's job (Module Graph), so every
 * `ImportBinding.resolvedModuleId` here stays `undefined`. A syntax error never throws past this
 * function: it's converted into a `Diagnostic` and every other declaration still parses
 * (Section 2's syntax-error tolerance).
 */
export function parseFile(params: { fileId: FileId; path: string; content: string }): ParseFileResult {
  const { fileId, path, content } = params;
  const moduleId = toModuleId(path);

  const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKindFor(path));

  // ts.createSourceFile never throws on malformed input — it best-effort parses and records
  // syntax errors on the (non-public, but stable and widely relied upon) `parseDiagnostics`
  // property. Using it here avoids building a full `ts.Program` per file just to retrieve syntax
  // diagnostics, which ADR-0006 explicitly wants to avoid for a per-file-only parse.
  const parseDiagnostics = (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const diagnostics: Diagnostic[] = parseDiagnostics.map((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    const parseError = new ParseError(message, path);
    return { code: parseError.code, severity: "error", message, source: "parser", filePath: path };
  });

  const symbols: SymbolEntity[] = [];
  const functions: FunctionEntity[] = [];
  const classes: ClassEntity[] = [];
  const imports: ImportBinding[] = [];
  const exports: ExportBinding[] = [];
  const localSymbolIdByName = new Map<string, SymbolId>();

  function addSymbol(kind: SymbolKind, name: string, node: ts.Node, exported: boolean, typeText?: string): SymbolId {
    const offset = node.getStart(sourceFile);
    const id = toSymbolId(path, kind, name, offset);
    const visibility: Visibility = exported ? "public" : "internal";
    symbols.push({
      id,
      name,
      kind,
      moduleId,
      declarationLocation: toLocation(fileId, path, sourceFile, node),
      visibility,
      exported,
      ...(typeText ? { typeText } : {}),
    });
    localSymbolIdByName.set(name, id);
    return id;
  }

  function extractParameters(params: ts.NodeArray<ts.ParameterDeclaration>): readonly Parameter[] {
    return params.map((p) => ({
      name: nameOf(p) ?? p.name.getText(sourceFile),
      ...(p.type ? { typeText: p.type.getText(sourceFile) } : {}),
      optional: Boolean(p.questionToken) || Boolean(p.initializer),
      ...(p.initializer ? { defaultValueText: p.initializer.getText(sourceFile) } : {}),
    }));
  }

  function buildFunctionEntity(
    node: ts.FunctionDeclaration | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
    name: string,
    flavor: FunctionFlavor,
    symbolId: SymbolId,
    exported: boolean,
    ownerClassId?: ClassId,
  ): FunctionEntity {
    const offset = node.getStart(sourceFile);
    const isAsync = hasModifier(node, ts.SyntaxKind.AsyncKeyword);
    const isGenerator = "asteriskToken" in node && Boolean(node.asteriskToken);
    const returnType = "type" in node ? node.type : undefined;
    return {
      id: toFunctionId(path, name, offset),
      symbolId,
      moduleId,
      ...(ownerClassId ? { ownerClassId } : {}),
      name,
      flavor,
      parameters: extractParameters(node.parameters),
      ...(returnType ? { returnTypeText: returnType.getText(sourceFile) } : {}),
      isAsync,
      isGenerator,
      isExported: exported,
      location: toLocation(fileId, path, sourceFile, node),
    };
  }

  function visitClassMember(member: ts.ClassElement, ownerClassId: ClassId): { methodId?: FunctionId; property?: ClassProperty } {
    if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
      const name = ts.isConstructorDeclaration(member) ? "constructor" : (nameOf(member) ?? "<anonymous>");
      const flavor: FunctionFlavor = ts.isConstructorDeclaration(member)
        ? "constructor"
        : ts.isGetAccessor(member)
          ? "getter"
          : ts.isSetAccessor(member)
            ? "setter"
            : "method";
      const offset = member.getStart(sourceFile);
      const symbolId = toSymbolId(path, "method", name, offset);
      const entity = buildFunctionEntity(member, name, flavor, symbolId, false, ownerClassId);
      functions.push(entity);
      return { methodId: entity.id };
    }
    if (ts.isPropertyDeclaration(member)) {
      const name = nameOf(member) ?? member.name.getText(sourceFile);
      const visibility: "public" | "private" | "protected" = hasModifier(member, ts.SyntaxKind.PrivateKeyword)
        ? "private"
        : hasModifier(member, ts.SyntaxKind.ProtectedKeyword)
          ? "protected"
          : "public";
      return {
        property: {
          name,
          ...(member.type ? { typeText: member.type.getText(sourceFile) } : {}),
          visibility,
          isStatic: hasModifier(member, ts.SyntaxKind.StaticKeyword),
          isReadonly: hasModifier(member, ts.SyntaxKind.ReadonlyKeyword),
          decorators: decoratorsOf(sourceFile, member),
        },
      };
    }
    return {};
  }

  function visitClassDeclaration(node: ts.ClassDeclaration, exported: boolean): void {
    const name = node.name ? node.name.text : "default";
    const offset = node.getStart(sourceFile);
    const symbolId = addSymbol("class", name, node, exported);
    const classId = toClassId(path, name, offset);

    const methods: FunctionId[] = [];
    const properties: ClassProperty[] = [];
    for (const member of node.members) {
      const { methodId, property } = visitClassMember(member, classId);
      if (methodId) methods.push(methodId);
      if (property) properties.push(property);
    }

    let extendsSymbolId: SymbolId | undefined;
    const implementsSymbolIds: SymbolId[] = [];
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) {
        const typeName = ts.isIdentifier(type.expression) ? type.expression.text : undefined;
        if (!typeName) continue;
        const resolved = localSymbolIdByName.get(typeName);
        if (!resolved) continue; // cross-file base/interface — unresolved this phase (ADR-0006)
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) extendsSymbolId = resolved;
        else implementsSymbolIds.push(resolved);
      }
    }

    classes.push({
      id: classId,
      symbolId,
      moduleId,
      name,
      isAbstract: hasModifier(node, ts.SyntaxKind.AbstractKeyword),
      isExported: exported,
      ...(extendsSymbolId ? { extendsSymbolId } : {}),
      implementsSymbolIds,
      methods,
      properties,
      decorators: decoratorsOf(sourceFile, node),
      location: toLocation(fileId, path, sourceFile, node),
    });
  }

  function visitFunctionDeclaration(node: ts.FunctionDeclaration, exported: boolean): void {
    const name = node.name ? node.name.text : "default";
    const symbolId = addSymbol("function", name, node, exported);
    functions.push(buildFunctionEntity(node, name, "function-declaration", symbolId, exported));
  }

  function visitVariableStatement(node: ts.VariableStatement, exported: boolean): void {
    for (const decl of node.declarationList.declarations) {
      const name = nameOf(decl);
      if (!name) continue; // destructuring patterns aren't tracked as a single named symbol (Phase 2 scope)

      if (decl.initializer && ts.isArrowFunction(decl.initializer)) {
        const arrow = decl.initializer;
        const symbolId = addSymbol("function", name, decl, exported, decl.type?.getText(sourceFile));
        functions.push(buildFunctionEntity(arrow, name, "arrow", symbolId, exported));
        continue;
      }

      addSymbol("variable", name, decl, exported, decl.type?.getText(sourceFile));
    }
  }

  function visitImportDeclaration(node: ts.ImportDeclaration): void {
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const specifier = node.moduleSpecifier.text;

    if (!node.importClause) {
      imports.push({ fileId, specifier, kind: "side-effect", location: toLocation(fileId, path, sourceFile, node) });
      return;
    }

    if (node.importClause.name) {
      imports.push({
        fileId,
        specifier,
        kind: "default",
        importedName: "default",
        localName: node.importClause.name.text,
        location: toLocation(fileId, path, sourceFile, node),
      });
    }

    const bindings = node.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      imports.push({ fileId, specifier, kind: "namespace", localName: bindings.name.text, location: toLocation(fileId, path, sourceFile, node) });
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const kind: ImportKind = "named";
        imports.push({
          fileId,
          specifier,
          kind,
          importedName: (element.propertyName ?? element.name).text,
          localName: element.name.text,
          location: toLocation(fileId, path, sourceFile, element),
        });
      }
    }
  }

  function visitExportDeclaration(node: ts.ExportDeclaration): void {
    const specifierText = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;

    if (specifierText) {
      const kind: ExportKind = "re-export";
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          exports.push({ fileId, kind, exportedName: element.name.text, location: toLocation(fileId, path, sourceFile, element) });
        }
      } else {
        // `export * from "specifier"` — no individual named bindings to enumerate.
        exports.push({ fileId, kind, exportedName: "*", location: toLocation(fileId, path, sourceFile, node) });
      }
      return;
    }

    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const localName = (element.propertyName ?? element.name).text;
        const symbolId = localSymbolIdByName.get(localName);
        exports.push({
          fileId,
          kind: "named",
          exportedName: element.name.text,
          ...(symbolId ? { symbolId } : {}),
          location: toLocation(fileId, path, sourceFile, element),
        });
      }
    }
  }

  function visitTopLevelStatement(node: ts.Statement): void {
    const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword);

    if (ts.isFunctionDeclaration(node)) {
      visitFunctionDeclaration(node, exported);
    } else if (ts.isClassDeclaration(node)) {
      visitClassDeclaration(node, exported);
    } else if (ts.isInterfaceDeclaration(node)) {
      addSymbol("interface", node.name.text, node, exported);
    } else if (ts.isTypeAliasDeclaration(node)) {
      addSymbol("type-alias", node.name.text, node, exported, node.type.getText(sourceFile));
    } else if (ts.isEnumDeclaration(node)) {
      addSymbol("enum", node.name.text, node, exported);
    } else if (ts.isVariableStatement(node)) {
      visitVariableStatement(node, exported);
    } else if (ts.isImportDeclaration(node)) {
      visitImportDeclaration(node);
    } else if (ts.isExportDeclaration(node)) {
      visitExportDeclaration(node);
    } else if (ts.isExportAssignment(node)) {
      exports.push({ fileId, kind: "default", exportedName: "default", location: toLocation(fileId, path, sourceFile, node) });
    }
  }

  function visitDynamicImports(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        imports.push({ fileId, specifier: arg.text, kind: "dynamic", location: toLocation(fileId, path, sourceFile, node) });
      }
    }
    ts.forEachChild(node, visitDynamicImports);
  }

  for (const statement of sourceFile.statements) {
    visitTopLevelStatement(statement);
  }
  visitDynamicImports(sourceFile);

  const module: Module = {
    id: moduleId,
    fileId,
    imports,
    exports,
    declaredSymbols: symbols.map((s) => s.id),
  };

  return { module, symbols, functions, classes, diagnostics };
}
