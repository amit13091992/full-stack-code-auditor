import { describe, expect, it } from "vitest";
import { TAINT_SIGNATURES, matchesCallSite } from "../../packages/graph/src/index.js";
import type { CallSite } from "../../packages/core/src/index.js";

function site(overrides: Partial<CallSite>): CallSite {
  return {
    calleeKind: "identifier",
    isNewExpression: false,
    argumentCount: 0,
    hasFunctionArgument: false,
    location: { fileId: "f.ts" as CallSite["location"]["fileId"], startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 },
    ...overrides,
  };
}

function find(name: string) {
  const entry = TAINT_SIGNATURES.find((s) => s.name === name);
  if (!entry) throw new Error(`no signature named ${name}`);
  return entry;
}

describe("TAINT_SIGNATURES", () => {
  it("process.env matches an env-var read used in a further call, not an unrelated receiver", () => {
    const sig = find("process.env");
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "process.env.DB_URL", calleeName: "trim" }), sig.match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "config.env", calleeName: "trim" }), sig.match)).toBe(false);
  });

  it("req.query/params/body/headers/cookies each match their own prefix only", () => {
    const cases: readonly [string, string][] = [
      ["req.query", "req.query.id"],
      ["req.params", "req.params.id"],
      ["req.body", "req.body.name"],
      ["req.headers", "req.headers.authorization"],
      ["req.cookies", "req.cookies.session"],
    ];
    for (const [name, receiverText] of cases) {
      const sig = find(name);
      expect(matchesCallSite(site({ calleeKind: "member", receiverText, calleeName: "toString" }), sig.match)).toBe(true);
      expect(matchesCallSite(site({ calleeKind: "member", receiverText: "res.locals", calleeName: "toString" }), sig.match)).toBe(false);
    }
  });

  it("fs.readFile matches fs.readFile/readFileSync but not unrelated fs calls or other receivers", () => {
    const sig = find("fs.readFile");
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "fs", calleeName: "readFile" }), sig.match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "fs", calleeName: "readFileSync" }), sig.match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "fs", calleeName: "writeFile" }), sig.match)).toBe(false);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "http", calleeName: "readFile" }), sig.match)).toBe(false);
  });

  it("eval matches only the bare identifier call, not a member call named eval", () => {
    const sig = find("eval");
    expect(matchesCallSite(site({ calleeKind: "identifier", calleeName: "eval" }), sig.match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "vm", calleeName: "eval" }), sig.match)).toBe(false);
  });

  it("child_process.exec matches exec/execSync on child_process, not on an unrelated receiver", () => {
    const sig = find("child_process.exec");
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "child_process", calleeName: "exec" }), sig.match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "child_process", calleeName: "execSync" }), sig.match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "child_process", calleeName: "spawn" }), sig.match)).toBe(false);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "utils", calleeName: "exec" }), sig.match)).toBe(false);
  });

  it("db-client.query matches .query on a db-client-shaped receiver, not an unrelated .query call", () => {
    const sig = find("db-client.query");
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "this.db", calleeName: "query" }), sig.match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "pool", calleeName: "query" }), sig.match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "searchIndex", calleeName: "query" }), sig.match)).toBe(false);
  });

  it("template.render matches any .render(...) member call", () => {
    const sig = find("template.render");
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "res", calleeName: "render" }), sig.match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "res", calleeName: "send" }), sig.match)).toBe(false);
  });

  it("escapeHtml/parseInt/mysql.escape sanitizers match their own name only", () => {
    expect(matchesCallSite(site({ calleeKind: "identifier", calleeName: "escapeHtml" }), find("escapeHtml").match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "identifier", calleeName: "sanitize" }), find("escapeHtml").match)).toBe(false);

    expect(matchesCallSite(site({ calleeKind: "identifier", calleeName: "parseInt" }), find("parseInt").match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "Number", calleeName: "parseInt" }), find("parseInt").match)).toBe(false);

    expect(matchesCallSite(site({ calleeKind: "member", receiverText: "mysql", calleeName: "escape" }), find("mysql.escape").match)).toBe(true);
    expect(matchesCallSite(site({ calleeKind: "identifier", calleeName: "escape" }), find("mysql.escape").match)).toBe(false);
  });

  it("every entry declares a taintKind for sources/sinks and none for sanitizers", () => {
    for (const entry of TAINT_SIGNATURES) {
      if (entry.kind === "sanitizer") expect(entry.taintKind).toBeUndefined();
      else expect(entry.taintKind).toBeDefined();
    }
  });
});
