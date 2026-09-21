import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FileId, FunctionEntity } from "../../packages/core/src/index.js";
import { parseFile } from "../../packages/parser/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/parser/basic-constructs");

async function parseFixture(name: string) {
  const filePath = path.join(FIXTURES_ROOT, name);
  const content = await fs.readFile(filePath, "utf-8");
  return parseFile({ fileId: name as FileId, path: name, content });
}

function findFn(functions: readonly FunctionEntity[], name: string): FunctionEntity {
  const fn = functions.find((f) => f.name === name);
  if (!fn) throw new Error(`expected a function named ${name}`);
  return fn;
}

describe("parseFile / call-sites.ts", () => {
  it("has no diagnostics", async () => {
    const result = await parseFixture("call-sites.ts");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("records a plain identifier call", async () => {
    const result = await parseFixture("call-sites.ts");
    const fn = findFn(result.functions, "plainCall");
    expect(fn.calls).toHaveLength(1);
    expect(fn.calls[0]).toMatchObject({ calleeKind: "identifier", calleeName: "foo", isNewExpression: false, argumentCount: 0 });
  });

  it("records a member/property call with the receiver text", async () => {
    const result = await parseFixture("call-sites.ts");
    const fn = findFn(result.functions, "memberCall");
    expect(fn.calls).toHaveLength(1);
    expect(fn.calls[0]).toMatchObject({ calleeKind: "member", calleeName: "method", receiverText: "obj" });
  });

  it("distinguishes a literal computed-member call from a dynamic one", async () => {
    const result = await parseFixture("call-sites.ts");

    const literal = findFn(result.functions, "computedLiteralCall");
    expect(literal.calls).toHaveLength(1);
    expect(literal.calls[0]).toMatchObject({
      calleeKind: "computed-member",
      calleeName: "method",
      receiverText: "obj",
      isComputedKeyStatic: true,
    });

    const dynamic = findFn(result.functions, "computedDynamicCall");
    const dynamicCall = dynamic.calls.find((c) => c.calleeKind === "computed-member");
    expect(dynamicCall).toBeDefined();
    expect(dynamicCall?.isComputedKeyStatic).toBe(false);
    expect(dynamicCall?.calleeName).toBeUndefined();
    expect(dynamicCall?.receiverText).toBe("obj");
  });

  it("records a new expression as a constructor call", async () => {
    const result = await parseFixture("call-sites.ts");
    const fn = findFn(result.functions, "newCall");
    expect(fn.calls).toHaveLength(1);
    expect(fn.calls[0]).toMatchObject({ calleeKind: "identifier", calleeName: "Foo", isNewExpression: true });
  });

  it("captures the receiver before .call/.apply/.bind, not call/apply/bind itself", async () => {
    const result = await parseFixture("call-sites.ts");
    const fn = findFn(result.functions, "callApplyBindCalls");
    expect(fn.calls).toHaveLength(3);

    const callSite = fn.calls.find((c) => c.callApplyBindKind === "call");
    expect(callSite).toMatchObject({ calleeKind: "call-apply-bind", receiverText: "foo", argumentCount: 3 });

    const applySite = fn.calls.find((c) => c.callApplyBindKind === "apply");
    expect(applySite).toMatchObject({ calleeKind: "call-apply-bind", receiverText: "foo", argumentCount: 2 });

    const bindSite = fn.calls.find((c) => c.callApplyBindKind === "bind");
    expect(bindSite).toMatchObject({ calleeKind: "call-apply-bind", receiverText: "foo", argumentCount: 1 });
  });

  it("flags a call argument that is itself a function/arrow expression", async () => {
    const result = await parseFixture("call-sites.ts");
    const fn = findFn(result.functions, "callbackArgument");
    const mapCall = fn.calls.find((c) => c.calleeName === "map");
    const forEachCall = fn.calls.find((c) => c.calleeName === "forEach");
    expect(mapCall?.hasFunctionArgument).toBe(true);
    expect(forEachCall?.hasFunctionArgument).toBe(true);
  });

  it("records an empty calls array for a function with no calls", async () => {
    const result = await parseFixture("call-sites.ts");
    const fn = findFn(result.functions, "noCalls");
    expect(fn.calls).toEqual([]);
  });

  it("attributes a call inside a nested function body to the nested function, not the outer one", async () => {
    const result = await parseFixture("call-sites.ts");
    const outer = findFn(result.functions, "outer");
    const inner = findFn(result.functions, "inner");

    expect(inner.calls.map((c) => c.calleeName)).toEqual(["innerOnlyCall"]);
    expect(outer.calls.map((c) => c.calleeName).sort()).toEqual(["inner", "outerOnlyCall"]);

    // The nested call is not associated with the outer function it doesn't lexically appear in.
    expect(outer.calls.some((c) => c.calleeName === "innerOnlyCall")).toBe(false);
    expect(inner.calls.some((c) => c.calleeName === "outerOnlyCall")).toBe(false);
  });
});
