import { describe, expect, it } from "vitest";
import { sqlInjectionAnalyzer } from "../../packages/analyzers/src/index.js";
import { buildTaintGraph, InMemoryGraph } from "../../packages/graph/src/index.js";
import { noopLogger } from "../../packages/core/src/index.js";
import type {
  AnalyzerConfig,
  AnalyzerContext,
  CallSite,
  FileId,
  FunctionEntity,
  FunctionId,
  Graph,
  ModuleId,
  ProjectId,
  ProjectModel,
  RepositoryId,
  SourceLocation,
  SymbolId,
} from "../../packages/core/src/index.js";

function loc(path: string): SourceLocation {
  return { fileId: path as FileId, path };
}

function callSite(overrides: Partial<CallSite>): CallSite {
  return {
    calleeKind: "identifier",
    isNewExpression: false,
    argumentCount: 0,
    hasFunctionArgument: false,
    location: loc("f.ts"),
    ...overrides,
  };
}

function fn(overrides: Partial<FunctionEntity> & { id: string; name: string }): FunctionEntity {
  return {
    id: overrides.id as FunctionId,
    symbolId: `sym:${overrides.id}` as SymbolId,
    moduleId: "mod:f" as ModuleId,
    name: overrides.name,
    flavor: "function-declaration",
    parameters: [],
    isAsync: false,
    isGenerator: false,
    isExported: false,
    location: loc(`${overrides.id}.ts`),
    calls: [],
    ...overrides,
  };
}

function emptyProject(functions: readonly FunctionEntity[]): ProjectModel {
  return {
    id: "proj:test" as ProjectId,
    repository: {
      metadata: { id: "repo:test" as RepositoryId, root: "/tmp/test", vcs: "none", isMonorepo: false },
      packages: [],
    },
    frameworks: [],
    files: [],
    modules: [],
    symbols: [],
    functions,
    classes: [],
    dependencies: [],
    endpoints: [],
    databaseEntities: [],
    services: [],
    securityBoundaries: [],
  };
}

function contextFor(functions: readonly FunctionEntity[], taintGraph?: Graph): AnalyzerContext {
  const config: AnalyzerConfig = {
    root: "/tmp/test",
    profile: "standard",
    ignore: { patterns: [], respectGitignore: true },
    incremental: { enabled: false },
    sandbox: { enabled: true, networkAccess: false },
  };
  return {
    scanId: "test-scan" as never,
    project: emptyProject(functions),
    frameworks: [],
    graphs: { taintGraph },
    config,
    logger: noopLogger,
    events: { on: () => () => {}, emit: () => {} },
    signal: new AbortController().signal,
  };
}

const reqQuerySite = callSite({ calleeKind: "member", calleeName: "toString", receiverText: "req.query.id" });
const dbQuerySite = callSite({ calleeKind: "member", calleeName: "query", receiverText: "db" });
const sanitizerSite = callSite({ calleeKind: "identifier", calleeName: "parseInt" });
const evalSite = callSite({ calleeKind: "identifier", calleeName: "eval" });

describe("security/sql-injection", () => {
  it("flags exactly one finding for an unsanitized direct source-to-sql-sink flow", async () => {
    const handler = fn({ id: "handler1", name: "handler", calls: [reqQuerySite, dbQuerySite] });
    const callGraph = new InMemoryGraph();
    const taintGraph = buildTaintGraph([handler], callGraph);
    const context = contextFor([handler], taintGraph);

    const result = await sqlInjectionAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.ruleId).toBe("security/sql-injection");
    expect(finding.category).toBe("security");
    expect(finding.severity).toBe("critical");
    expect(finding.confidence).toBeGreaterThan(0);
    expect(finding.confidence).toBeLessThan(1);
    expect(finding.status).toBe("detected");
    expect(finding.cwe).toBe("CWE-89");
    expect(finding.owasp).toBeDefined();
    expect(finding.evidenceIds.length).toBe(2);
    expect(finding.locations.length).toBeGreaterThan(0);
    expect(result.evidence.some((e) => e.summary.includes("req.query"))).toBe(true);
    expect(result.evidence.every((e) => e.locations.length > 0)).toBe(true);
  });

  it("reports a sanitized flow at reduced severity/confidence rather than suppressing it", async () => {
    const source = fn({ id: "src-san", name: "source", calls: [reqQuerySite] });
    const middle = fn({ id: "mid-san", name: "middle", calls: [sanitizerSite] });
    const sink = fn({ id: "snk-san", name: "sink", calls: [dbQuerySite] });
    const callGraph = new InMemoryGraph();
    for (const f of [source, middle, sink]) callGraph.addNode({ id: `function:${f.id}` as never, type: "function", entityId: f.id });
    callGraph.addEdge({
      id: "e1" as never,
      type: "CALLS",
      fromNodeId: `function:${source.id}` as never,
      toNodeId: `function:${middle.id}` as never,
      certainty: "direct",
    });
    callGraph.addEdge({
      id: "e2" as never,
      type: "CALLS",
      fromNodeId: `function:${middle.id}` as never,
      toNodeId: `function:${sink.id}` as never,
      certainty: "direct",
    });
    const taintGraph = buildTaintGraph([source, middle, sink], callGraph);
    const context = contextFor([source, middle, sink], taintGraph);

    const result = await sqlInjectionAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.severity).toBe("low");
    expect(finding.confidence).toBeLessThan(0.5);
  });

  it("gives lower confidence to a flow reached only through a dynamic CALLS edge", async () => {
    const source = fn({ id: "src-dyn", name: "source", calls: [reqQuerySite] });
    const sink = fn({ id: "snk-dyn", name: "sink", calls: [dbQuerySite] });
    const callGraph = new InMemoryGraph();
    callGraph.addNode({ id: `function:${source.id}` as never, type: "function", entityId: source.id });
    callGraph.addNode({ id: `function:${sink.id}` as never, type: "function", entityId: sink.id });
    callGraph.addEdge({
      id: "e1" as never,
      type: "CALLS",
      fromNodeId: `function:${source.id}` as never,
      toNodeId: `function:${sink.id}` as never,
      certainty: "dynamic",
    });
    const taintGraph = buildTaintGraph([source, sink], callGraph);
    const context = contextFor([source, sink], taintGraph);

    const result = await sqlInjectionAnalyzer.analyze(context);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.confidence).toBeLessThan(0.5);
  });

  it("produces no finding for a non-SQL sink (eval)", async () => {
    const handler = fn({ id: "handler-eval", name: "handler", calls: [reqQuerySite, evalSite] });
    const callGraph = new InMemoryGraph();
    const taintGraph = buildTaintGraph([handler], callGraph);
    const context = contextFor([handler], taintGraph);

    const result = await sqlInjectionAnalyzer.analyze(context);
    expect(result.findings).toHaveLength(0);
  });

  it("produces no findings and does not crash when no taintGraph is present", async () => {
    const handler = fn({ id: "handler-none", name: "handler", calls: [reqQuerySite, dbQuerySite] });
    const context = contextFor([handler], undefined);

    expect(sqlInjectionAnalyzer.supports(context)).toBe(false);
    const result = await sqlInjectionAnalyzer.analyze(context);
    expect(result.findings).toHaveLength(0);
  });
});
