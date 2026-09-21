import ts from "typescript";
import type {
  CallApplyBindKind,
  CallCalleeKind,
  CallSite,
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

  // Call-site extraction (Phase 4 prerequisite, docs/tasks/phase-4-call-graph.md step 2). Kept as
  // a bookkeeping side-channel rather than threading `calls` through `buildFunctionEntity`'s
  // return value, because call sites are only fully known after the whole tree is walked (a
  // function's own declaration is visited before its body's calls are). Every `FunctionEntity`
  // gets `calls: []` at construction time and is patched with its real call sites in the final
  // mapping step below.
  const functionNodeById = new Map<ts.Node, FunctionId>();
  const callsByFunctionId = new Map<FunctionId, CallSite[]>();

  function recordCallSite(functionId: FunctionId, site: CallSite): void {
    const existing = callsByFunctionId.get(functionId);
    if (existing) existing.push(site);
    else callsByFunctionId.set(functionId, [site]);
  }

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
    node:
      | ts.FunctionDeclaration
      | ts.FunctionExpression
      | ts.ArrowFunction
      | ts.MethodDeclaration
      | ts.ConstructorDeclaration
      | ts.GetAccessorDeclaration
      | ts.SetAccessorDeclaration,
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
    const id = toFunctionId(path, name, offset);
    functionNodeById.set(node, id);
    return {
      id,
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
      calls: [], // patched with real call sites once the whole tree is walked — see recordCallSite
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
      if (decl.initializer && visitRequireInitializer(decl.name, decl.initializer)) continue;

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

  /**
   * CommonJS support (Section 5's JS/TS scope covers both module systems — a lot of real,
   * especially older, Node.js code never migrated off `require()`). Reuses the existing
   * `ImportKind` values rather than adding a new one, since a `require()` call is semantically
   * the same shape as an ES import, just spelled differently: `const x = require("y")` is a
   * default-style import, `const { a, b } = require("y")` is named imports.
   *
   * Returns `true` if `initializer` was a `require(...)` call and was handled (so the caller
   * skips its normal variable-declaration handling); `false` otherwise.
   */
  function visitRequireInitializer(bindingName: ts.BindingName, initializer: ts.Expression): boolean {
    if (!isRequireCall(initializer)) return false;
    const specifier = initializer.arguments[0];
    if (!specifier || !ts.isStringLiteral(specifier)) return false; // require(someVariable) — not statically resolvable

    if (ts.isIdentifier(bindingName)) {
      imports.push({
        fileId,
        specifier: specifier.text,
        kind: "default",
        importedName: "default",
        localName: bindingName.text,
        location: toLocation(fileId, path, sourceFile, initializer),
      });
      return true;
    }

    if (ts.isObjectBindingPattern(bindingName)) {
      for (const element of bindingName.elements) {
        if (!ts.isIdentifier(element.name)) continue; // nested destructuring — Phase 2 scope doesn't track it
        imports.push({
          fileId,
          specifier: specifier.text,
          kind: "named",
          importedName: (element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName : element.name).text,
          localName: element.name.text,
          location: toLocation(fileId, path, sourceFile, element),
        });
      }
      return true;
    }

    return false; // array destructuring, etc. — not a meaningful require() pattern
  }

  function isRequireCall(expr: ts.Expression): expr is ts.CallExpression {
    return ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "require" && expr.arguments.length > 0;
  }

  function visitBareRequireStatement(node: ts.ExpressionStatement): boolean {
    if (!isRequireCall(node.expression)) return false;
    const specifier = node.expression.arguments[0];
    if (!specifier || !ts.isStringLiteral(specifier)) return false;
    imports.push({ fileId, specifier: specifier.text, kind: "side-effect", location: toLocation(fileId, path, sourceFile, node) });
    return true;
  }

  /**
   * `module.exports = <expr>` (whole-module export, treated like a default export) and
   * `module.exports.foo = <expr>` / `exports.foo = <expr>` (named export `"foo"`). If the
   * right-hand side is a plain identifier referencing an already-declared local symbol, the
   * export is resolved to it — same-file only, same discipline as every other resolution in
   * this parser (ADR-0006).
   */
  function visitCommonJsExportStatement(node: ts.ExpressionStatement): boolean {
    const expr = node.expression;
    if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;

    const target = expr.left;
    const rhsName = ts.isIdentifier(expr.right) ? expr.right.text : undefined;
    const symbolId = rhsName ? localSymbolIdByName.get(rhsName) : undefined;

    // `module.exports = ...`
    if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) && target.expression.text === "module" && target.name.text === "exports") {
      exports.push({ fileId, kind: "default", exportedName: "default", ...(symbolId ? { symbolId } : {}), location: toLocation(fileId, path, sourceFile, node) });
      return true;
    }

    // `module.exports.foo = ...` or `exports.foo = ...`
    if (ts.isPropertyAccessExpression(target)) {
      const base = target.expression;
      const isModuleExports = ts.isPropertyAccessExpression(base) && ts.isIdentifier(base.expression) && base.expression.text === "module" && base.name.text === "exports";
      const isBareExports = ts.isIdentifier(base) && base.text === "exports";
      if (isModuleExports || isBareExports) {
        exports.push({ fileId, kind: "named", exportedName: target.name.text, ...(symbolId ? { symbolId } : {}), location: toLocation(fileId, path, sourceFile, node) });
        return true;
      }
    }

    return false;
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
    } else if (ts.isExpressionStatement(node)) {
      if (visitBareRequireStatement(node)) return;
      visitCommonJsExportStatement(node);
    }
  }

  type FunctionLikeNode =
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | ts.ConstructorDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration;

  function isFunctionLikeNode(node: ts.Node): node is FunctionLikeNode {
    return (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)
    );
  }

  /** Best-effort name for a function-like node reached only through the call-site walk (never a top-level declaration, which already has a name by construction). */
  function inferredNameOf(node: FunctionLikeNode): string {
    if (ts.isConstructorDeclaration(node)) return "constructor";
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text;
    const parent = node.parent;
    if ((ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    return nameOf(node) ?? "<anonymous>";
  }

  function flavorOf(node: FunctionLikeNode): FunctionFlavor {
    if (ts.isConstructorDeclaration(node)) return "constructor";
    if (ts.isGetAccessor(node)) return "getter";
    if (ts.isSetAccessor(node)) return "setter";
    if (ts.isMethodDeclaration(node)) return "method";
    if (ts.isArrowFunction(node)) return "arrow";
    // ts.FunctionExpression has no dedicated FunctionFlavor value; closest existing shape.
    return "function-declaration";
  }

  /**
   * A function-like node not already registered by the declaration-focused walk above — e.g. a
   * nested `function inner() {}`, a locally-assigned arrow/function expression, or an inline
   * callback. Registered lazily here (not exported, since it's never a top-level declaration) so
   * calls made from inside it attribute to *it*, not to whatever function encloses it.
   */
  function registerNestedFunctionEntity(node: FunctionLikeNode): FunctionId {
    const name = inferredNameOf(node);
    const offset = node.getStart(sourceFile);
    const symbolId = toSymbolId(path, "function", name, offset);
    symbols.push({
      id: symbolId,
      name,
      kind: "function",
      moduleId,
      declarationLocation: toLocation(fileId, path, sourceFile, node),
      visibility: "internal",
      exported: false,
    });
    const entity = buildFunctionEntity(node, name, flavorOf(node), symbolId, false);
    functions.push(entity);
    return entity.id;
  }

  function isFunctionLikeArgument(arg: ts.Expression): boolean {
    return ts.isArrowFunction(arg) || ts.isFunctionExpression(arg);
  }

  const CALL_APPLY_BIND_NAMES: ReadonlySet<string> = new Set(["call", "apply", "bind"]);

  function buildCallSite(node: ts.CallExpression | ts.NewExpression): CallSite {
    const isNewExpression = ts.isNewExpression(node);
    const calleeExpr = node.expression;
    const argsArray: readonly ts.Expression[] = node.arguments ? Array.from(node.arguments) : [];

    let calleeKind: CallCalleeKind;
    let calleeName: string | undefined;
    let receiverText: string | undefined;
    let isComputedKeyStatic: boolean | undefined;
    let callApplyBindKind: CallApplyBindKind | undefined;

    if (!isNewExpression && ts.isPropertyAccessExpression(calleeExpr) && CALL_APPLY_BIND_NAMES.has(calleeExpr.name.text)) {
      calleeKind = "call-apply-bind";
      callApplyBindKind = calleeExpr.name.text as CallApplyBindKind;
      receiverText = calleeExpr.expression.getText(sourceFile);
    } else if (ts.isPropertyAccessExpression(calleeExpr)) {
      calleeKind = "member";
      receiverText = calleeExpr.expression.getText(sourceFile);
      calleeName = calleeExpr.name.text;
    } else if (ts.isElementAccessExpression(calleeExpr)) {
      calleeKind = "computed-member";
      receiverText = calleeExpr.expression.getText(sourceFile);
      const keyExpr = calleeExpr.argumentExpression;
      if (ts.isStringLiteralLike(keyExpr)) {
        isComputedKeyStatic = true;
        calleeName = keyExpr.text;
      } else {
        isComputedKeyStatic = false;
      }
    } else if (ts.isIdentifier(calleeExpr)) {
      calleeKind = "identifier";
      calleeName = calleeExpr.text;
    } else {
      // Callee isn't identifier/member/computed-member/call-apply-bind shaped (e.g. calling the
      // result of another call expression, an IIFE). Name intentionally omitted rather than
      // guessed (ADR-0004) — the graph builder must treat this as unresolvable.
      calleeKind = "identifier";
    }

    return {
      calleeKind,
      ...(calleeName !== undefined ? { calleeName } : {}),
      ...(receiverText !== undefined ? { receiverText } : {}),
      ...(isComputedKeyStatic !== undefined ? { isComputedKeyStatic } : {}),
      ...(callApplyBindKind !== undefined ? { callApplyBindKind } : {}),
      isNewExpression,
      argumentCount: argsArray.length,
      hasFunctionArgument: argsArray.some(isFunctionLikeArgument),
      location: toLocation(fileId, path, sourceFile, node),
    };
  }

  function collectCallSites(node: ts.Node, currentFunctionId: FunctionId | undefined): void {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (currentFunctionId) recordCallSite(currentFunctionId, buildCallSite(node));
    }

    if (isFunctionLikeNode(node)) {
      const functionId = functionNodeById.get(node) ?? registerNestedFunctionEntity(node);
      ts.forEachChild(node, (child) => collectCallSites(child, functionId));
      return;
    }

    ts.forEachChild(node, (child) => collectCallSites(child, currentFunctionId));
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
  collectCallSites(sourceFile, undefined);

  const functionsWithCalls: FunctionEntity[] = functions.map((fn) => ({
    ...fn,
    calls: callsByFunctionId.get(fn.id) ?? [],
  }));

  const module: Module = {
    id: moduleId,
    fileId,
    imports,
    exports,
    declaredSymbols: symbols.map((s) => s.id),
  };

  return { module, symbols, functions: functionsWithCalls, classes, diagnostics };
}
