import type { ClassId, FunctionId, ModuleId, SourceLocation, SymbolId } from "./ids.js";

export interface Parameter {
  readonly name: string;
  readonly typeText?: string;
  readonly optional: boolean;
  readonly defaultValueText?: string;
}

export type FunctionFlavor = "function-declaration" | "arrow" | "method" | "constructor" | "getter" | "setter";

/**
 * How a call expression's callee was spelled, structurally — not whether it can be resolved.
 * Resolution (matching against declarations, deciding `EdgeCertainty`) is the Call Graph
 * builder's job (`@code-analyzer/graph`); this only records enough shape for that builder to
 * decide, e.g. a literal computed key (`obj["method"]()`) is statically resolvable the same way
 * `obj.method()` is, but a variable computed key (`obj[methodName]()`) is not.
 */
export type CallCalleeKind = "identifier" | "member" | "computed-member" | "call-apply-bind";

/** `.call()` / `.apply()` / `.bind()` dispatch — the real target is `receiverText`, not `call`/`apply`/`bind` itself. */
export type CallApplyBindKind = "call" | "apply" | "bind";

/** One call/`new` expression found in a function or method body. */
export interface CallSite {
  readonly calleeKind: CallCalleeKind;
  /** Identifier name (`identifier`), property name (`member`), or literal key text (`computed-member` with a string-literal key). Absent when the callee name isn't statically known (e.g. a variable computed key). */
  readonly calleeName?: string;
  /** Source text of the object/receiver expression for `member`, `computed-member`, and `call-apply-bind` calls (e.g. `obj` in `obj.method()`, `foo` in `foo.call(this)`). */
  readonly receiverText?: string;
  /** Only meaningful when `calleeKind` is `computed-member`: whether the computed key is a string literal (statically known) rather than an arbitrary expression. */
  readonly isComputedKeyStatic?: boolean;
  readonly callApplyBindKind?: CallApplyBindKind;
  readonly isNewExpression: boolean;
  readonly argumentCount: number;
  /** Whether any argument is itself a function/arrow expression — the "callback passed as argument" shape. */
  readonly hasFunctionArgument: boolean;
  readonly location: SourceLocation;
}

/** A callable unit. The primary node kind consumed by the call graph and taint engine. */
export interface FunctionEntity {
  readonly id: FunctionId;
  readonly symbolId: SymbolId;
  readonly moduleId: ModuleId;
  readonly ownerClassId?: ClassId;
  readonly name: string;
  readonly flavor: FunctionFlavor;
  readonly parameters: readonly Parameter[];
  readonly returnTypeText?: string;
  readonly isAsync: boolean;
  readonly isGenerator: boolean;
  readonly isExported: boolean;
  readonly location: SourceLocation;
  /** Call sites found directly in this function/method's body (not in nested functions — those get their own entry when tracked). Empty array means "none found", never "unknown" (ADR-0004). */
  readonly calls: readonly CallSite[];
}
