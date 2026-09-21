import type { CallSite, ClassEntity, EdgeCertainty, FunctionEntity, Graph, Module, NodeId } from "@code-analyzer/core";
import { InMemoryGraph } from "./in-memory-graph.js";
import { isRelativeSpecifier, resolveRelativeSpecifier } from "./module-graph.js";
import { classNodeId, edgeId, functionNodeId, moduleNodeId, symbolNodeId } from "./node-ids.js";

/**
 * Builds the Call Graph (Phase 4, docs/tasks/phase-4-call-graph.md): `CALLS` edges from every
 * `FunctionEntity` to whatever its recorded `CallSite`s invoke, resolved as far as static
 * analysis honestly allows. Nodes reuse Symbol Graph's function/class/symbol node ids exactly
 * (Section 35.12) — this is not a parallel node scheme.
 *
 * A call site that cannot be resolved to any real declaration (no type inference in this phase —
 * see Phase 3's documented gap) still gets exactly one `CALLS` edge, targeting a synthetic
 * `call-site` node scoped to that exact call expression. This is deliberately different from the
 * Module Graph's "no placeholder node" rule for external-package imports: that rule exists
 * because an external package genuinely has no project-internal declaration to ever point at, so
 * omitting the edge doesn't hide anything resolvable. Here, the call site is 100% real, project
 * -internal code whose *target* just can't be pinned down (dynamic dispatch, missing type
 * inference, unresolved inheritance) — collapsing that into "no edge" would be exactly the
 * "dynamic behavior silently disappearing" ADR-0004/Section 4 warns against. A `call-site` node
 * per unresolved call keeps the uncertainty visible and queryable without guessing an identity.
 *
 * The only true non-goal (no edge at all, consistent with Module Graph's existing exception) is a
 * call into an unresolvable global/external-package identifier (e.g. `console.log()`, a bare
 * `import` specifier) — there is no project-internal node, resolvable or not, to attach any edge
 * to, and it isn't "dynamic dispatch" in the ADR-0004 sense, just code outside this project.
 */
export function buildCallGraph(modules: readonly Module[], functions: readonly FunctionEntity[], classes: readonly ClassEntity[]): Graph {
  const graph = new InMemoryGraph();

  const knownModulePaths = new Set(modules.map((m) => m.id as string));
  const moduleById = new Map(modules.map((m) => [m.id as string, m]));
  const functionById = new Map(functions.map((f) => [f.id as string, f]));
  const topLevelFunctionsByModule = new Map<string, FunctionEntity[]>();
  for (const fn of functions) {
    if (fn.ownerClassId) continue;
    const list = topLevelFunctionsByModule.get(fn.moduleId as string);
    if (list) list.push(fn);
    else topLevelFunctionsByModule.set(fn.moduleId as string, [fn]);
  }
  const classesByModule = new Map<string, ClassEntity[]>();
  for (const cls of classes) {
    const list = classesByModule.get(cls.moduleId as string);
    if (list) list.push(cls);
    else classesByModule.set(cls.moduleId as string, [cls]);
  }
  const classById = new Map(classes.map((c) => [c.id as string, c]));
  const classBySymbolId = new Map(classes.map((c) => [c.symbolId as string, c]));

  for (const module of modules) graph.addNode({ id: moduleNodeId(module.id), type: "module", entityId: module.id });
  for (const fn of functions) graph.addNode({ id: functionNodeId(fn.id), type: "function", entityId: fn.id });
  for (const cls of classes) graph.addNode({ id: classNodeId(cls.id), type: "class", entityId: cls.id });

  type Target = { readonly nodeId: NodeId; readonly certainty: EdgeCertainty };

  function link(fromId: NodeId, toId: NodeId, certainty: EdgeCertainty): void {
    const id = edgeId("CALLS", fromId, toId);
    if (graph.getEdge(id)) return;
    graph.addEdge({ id, type: "CALLS", fromNodeId: fromId, toNodeId: toId, certainty });
  }

  function findDeclarationInModule(moduleId: string, name: string, preferClass: boolean): Target | undefined {
    const cls = classesByModule.get(moduleId)?.find((c) => c.name === name);
    const fn = topLevelFunctionsByModule.get(moduleId)?.find((f) => f.name === name);
    if (preferClass) {
      if (cls) return { nodeId: classNodeId(cls.id), certainty: "direct" };
      if (fn) return { nodeId: functionNodeId(fn.id), certainty: "direct" };
    } else {
      if (fn) return { nodeId: functionNodeId(fn.id), certainty: "direct" };
      if (cls) return { nodeId: classNodeId(cls.id), certainty: "direct" };
    }
    return undefined;
  }

  /**
   * Resolves a bare identifier callee name against the calling module: same-module declaration
   * (`"direct"`), or an `ImportBinding` whose specifier resolves to another parsed module
   * (`"resolved"`, and `"unknown"` targeting the module node if the exact declaration inside it
   * can't be pinned — e.g. a re-export chain). Returns `"external"` for a bare/unresolvable
   * specifier or a name with no binding at all (the one true non-goal case), `undefined` only
   * when nothing at all matches and isn't clearly external either (treated the same as
   * `"external"` by callers — see module-doc above).
   */
  function resolveIdentifier(module: Module, name: string, preferClass: boolean): Target | "external" {
    const sameModule = findDeclarationInModule(module.id as string, name, preferClass);
    if (sameModule) return sameModule;

    const binding = module.imports.find((b) => b.localName === name && b.kind !== "dynamic");
    if (!binding) return "external";
    if (!isRelativeSpecifier(binding.specifier)) return "external";

    const resolvedPath = resolveRelativeSpecifier(module.id as string, binding.specifier, knownModulePaths);
    if (!resolvedPath) return "external"; // relative but unresolvable -> same non-goal as Module Graph

    const declaredName = binding.importedName ?? name;
    const target = findDeclarationInModule(resolvedPath, declaredName, preferClass);
    if (target) return { nodeId: target.nodeId, certainty: "resolved" };
    return { nodeId: moduleNodeId(resolvedPath), certainty: "unknown" };
  }

  function callSiteNodeId(caller: FunctionEntity, site: CallSite): NodeId {
    const pos = site.location.range?.start;
    return `call-site:${caller.id}:${site.location.path}:${pos ? `${pos.line}:${pos.column}` : "?"}` as NodeId;
  }

  function unresolved(caller: FunctionEntity, site: CallSite, certainty: "dynamic" | "unknown"): void {
    const nodeId = callSiteNodeId(caller, site);
    if (!graph.getNode(nodeId)) {
      graph.addNode({ id: nodeId, type: "call-site", entityId: nodeId as string });
    }
    link(functionNodeId(caller.id), nodeId, certainty);
  }

  /** `this.method()` / same-class-static resolution, including the one-level-up EXTENDS fallback
   * Phase 3's same-file-only inheritance resolution allows (see class-doc above). */
  function resolveOnClass(cls: ClassEntity, methodName: string): Target | undefined {
    for (const methodId of cls.methods) {
      const fn = functionById.get(methodId as string);
      if (fn && fn.name === methodName) return { nodeId: functionNodeId(fn.id), certainty: "direct" };
    }
    if (cls.extendsSymbolId) {
      const superClass = classBySymbolId.get(cls.extendsSymbolId as string);
      if (superClass) {
        for (const methodId of superClass.methods) {
          const fn = functionById.get(methodId as string);
          if (fn && fn.name === methodName) return { nodeId: functionNodeId(fn.id), certainty: "inferred" };
        }
        // Superclass resolved same-file but doesn't declare the method either (may go further
        // up a chain Phase 3 doesn't record) -> point at the superclass's symbol, "unknown".
        return { nodeId: symbolNodeId(cls.extendsSymbolId), certainty: "unknown" };
      }
      // `extendsSymbolId` set but not a same-file class Phase 3 could resolve -> cross-file
      // inheritance chain, the documented gap -> "unknown", still pointing at the symbol we do
      // have (better than nothing, honest about not knowing what it resolves to).
      return { nodeId: symbolNodeId(cls.extendsSymbolId), certainty: "unknown" };
    }
    return undefined;
  }

  function resolveMemberTarget(caller: FunctionEntity, receiverText: string | undefined, calleeName: string | undefined): Target | "external" | undefined {
    if (!calleeName) return undefined;
    const module = moduleById.get(caller.moduleId as string);
    if (!module) return undefined;

    if (receiverText === "this" && caller.ownerClassId) {
      const cls = classById.get(caller.ownerClassId as string);
      if (cls) {
        const onClass = resolveOnClass(cls, calleeName);
        if (onClass) return onClass;
      }
      return undefined; // no extends chain and method isn't declared on the class -> unresolved
    }

    if (receiverText) {
      // Static-style call through a named class reference (`Foo.bar()`), same-file or cross-file.
      const sameModuleClass = classesByModule.get(caller.moduleId as string)?.find((c) => c.name === receiverText);
      if (sameModuleClass) {
        const onClass = resolveOnClass(sameModuleClass, calleeName);
        return onClass ?? undefined;
      }
      const binding = module.imports.find((b) => b.localName === receiverText && b.kind !== "dynamic");
      if (binding) {
        if (!isRelativeSpecifier(binding.specifier)) return "external";
        const resolvedPath = resolveRelativeSpecifier(module.id as string, binding.specifier, knownModulePaths);
        if (!resolvedPath) return "external";
        const declaredName = binding.importedName ?? receiverText;
        const remoteClass = classesByModule.get(resolvedPath)?.find((c) => c.name === declaredName);
        if (remoteClass) {
          for (const methodId of remoteClass.methods) {
            const fn = functionById.get(methodId as string);
            if (fn && fn.name === calleeName) return { nodeId: functionNodeId(fn.id), certainty: "resolved" };
          }
        }
      }
    }
    // Arbitrary-variable receiver with no type inference (Phase 3's documented gap) -> genuinely
    // unresolvable, not "external": this is still project-internal code, just uncertain which
    // declaration it targets.
    return undefined;
  }

  for (const caller of functions) {
    for (const site of caller.calls) {
      const module = moduleById.get(caller.moduleId as string);
      if (!module) continue;

      // Callback-passed-as-argument (`array.map(fn)`): a nested function/arrow expression
      // literal passed as an argument gets its own `FunctionEntity` (parser step 2's nested-
      // function tracking) whose body is lexically contained inside this call's source range.
      // Its eventual invocation happens outside this AST (inside whatever `map`/`on`/etc. does),
      // so we can't say *when*/*how* it runs — but we can say control statically reaches it from
      // here, which is exactly the "unknown, not silently dropped" case the task doc calls out.
      // This is intentionally an ADDITIONAL edge alongside whatever the call's own callee
      // resolves to (see module-doc): the two edges represent two different relationships (call
      // resolution vs. callback reachability), not two answers to the same question.
      if (site.hasFunctionArgument) {
        const start = site.location.range?.start.offset;
        const end = site.location.range?.end.offset;
        for (const candidate of functions) {
          if (candidate.moduleId !== caller.moduleId || candidate.id === caller.id) continue;
          const candStart = candidate.location.range?.start.offset;
          const candEnd = candidate.location.range?.end.offset;
          if (start === undefined || end === undefined || candStart === undefined || candEnd === undefined) continue;
          // Strict containment (by character offset, not just line — a one-line callback body
          // would otherwise share start/end lines with its enclosing call expression):
          // the callback's whole body must sit lexically inside the call expression's range.
          if (candStart >= start && candEnd <= end && (candStart > start || candEnd < end)) {
            link(functionNodeId(caller.id), functionNodeId(candidate.id), "unknown");
          }
        }
      }

      let target: Target | "external" | undefined;

      switch (site.calleeKind) {
        case "identifier": {
          if (!site.calleeName) {
            target = undefined; // callee wasn't identifier-shaped at all (e.g. IIFE) — ADR-0004, no guessing
          } else {
            target = resolveIdentifier(module, site.calleeName, site.isNewExpression);
          }
          break;
        }
        case "member": {
          target = resolveMemberTarget(caller, site.receiverText, site.calleeName);
          break;
        }
        case "computed-member": {
          if (site.isComputedKeyStatic) {
            target = resolveMemberTarget(caller, site.receiverText, site.calleeName);
          } else {
            unresolved(caller, site, "dynamic");
            continue;
          }
          break;
        }
        case "call-apply-bind": {
          if (site.receiverText) {
            target = resolveIdentifier(module, site.receiverText, false);
            if (target === "external") {
              // Fall through to member-style resolution in case the receiver is `this.foo` or
              // `SomeClass.foo` rather than a bare identifier.
              const dot = site.receiverText.lastIndexOf(".");
              if (dot > 0) {
                const recv = site.receiverText.slice(0, dot);
                const name = site.receiverText.slice(dot + 1);
                const memberTarget = resolveMemberTarget(caller, recv, name);
                target = memberTarget ?? undefined;
              } else {
                target = undefined;
              }
            }
          } else {
            target = undefined;
          }
          if (!target) {
            unresolved(caller, site, "dynamic");
            continue;
          }
          break;
        }
      }

      if (target === "external" || target === undefined) {
        if (target === undefined) unresolved(caller, site, "unknown");
        // "external": documented non-goal, no edge at all (see module-doc).
        continue;
      }

      link(functionNodeId(caller.id), target.nodeId, target.certainty);
    }
  }

  return graph;
}
