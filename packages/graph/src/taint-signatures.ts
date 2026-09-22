import type { CallCalleeKind, CallSite, TaintSinkKind, TaintSourceKind } from "@code-analyzer/core";

/**
 * Fixed, deliberately small, named list of recognized source/sink/sanitizer call shapes
 * (`docs/tasks/phase-5-taint-graph.md` checklist step 3, ADR-0014). Phase 5 is explicit that this
 * is NOT a general points-to/taint-summary system or a full CWE catalogue — it is a first cut of
 * the JS/TS/Express-oriented shapes that are structurally recognizable from `CallSite` data
 * (`packages/core/src/domain/function.ts`) as parsed by Phase 3/4. Expanding this table with more
 * entries is ordinary follow-up work per signature; it is not a redesign and does not need its own
 * ADR unless it requires a new `CallSite` field or a new `TaintSourceKind`/`TaintSinkKind` member.
 *
 * `CallSite` only exists for actual call/`new` expressions — a bare property read like
 * `req.query.id` with no trailing call has no `CallSite` at all. Source shapes below therefore
 * match against `receiverText` (the source text of the object/receiver expression preceding the
 * final call, e.g. `"req.query"` in `req.query.toString()`) rather than inventing a "member
 * access" field that doesn't exist in parsed output today. Code that reads a source value but
 * never passes it into any further call (e.g. assigns `req.query.id` straight to a local variable
 * with no subsequent method call on it) is a known, honestly-scoped gap — see the scoping doc's
 * Non-goals — not silently claimed as covered here.
 */

export type TaintSignatureKind = "source" | "sink" | "sanitizer";

/** Simple string/shape predicates only (Section 4/35.13) — deliberately not a matcher DSL. */
export interface CallShapeMatch {
  readonly calleeKind?: CallCalleeKind;
  /** Exact match against `CallSite.calleeName`. */
  readonly calleeName?: string;
  /** Exact match against `CallSite.calleeName` for any name in the list. */
  readonly calleeNames?: readonly string[];
  /** Exact match against `CallSite.receiverText`. */
  readonly receiverText?: string;
  /** `CallSite.receiverText` starts with this prefix (e.g. `"req.query"` matches `req.query.id`). */
  readonly receiverTextStartsWith?: string;
  /** `CallSite.receiverText` ends with any of these (e.g. a `this.db`/`pool` shaped receiver). */
  readonly receiverTextEndsWithAny?: readonly string[];
}

export interface TaintSignature {
  /** Short, stable, human-reviewable name — not consumed programmatically beyond identification/debugging. */
  readonly name: string;
  readonly kind: TaintSignatureKind;
  /** Present for `"source"`/`"sink"` entries; absent for `"sanitizer"` (sanitizers don't carry a source/sink kind). */
  readonly taintKind?: TaintSourceKind | TaintSinkKind;
  readonly match: CallShapeMatch;
}

export function matchesCallSite(site: CallSite, match: CallShapeMatch): boolean {
  if (match.calleeKind !== undefined && site.calleeKind !== match.calleeKind) return false;
  if (match.calleeName !== undefined && site.calleeName !== match.calleeName) return false;
  if (match.calleeNames !== undefined && (site.calleeName === undefined || !match.calleeNames.includes(site.calleeName))) return false;
  if (match.receiverText !== undefined && site.receiverText !== match.receiverText) return false;
  if (match.receiverTextStartsWith !== undefined && !(site.receiverText?.startsWith(match.receiverTextStartsWith) ?? false)) return false;
  if (match.receiverTextEndsWithAny !== undefined && !match.receiverTextEndsWithAny.some((suffix) => site.receiverText?.endsWith(suffix) ?? false)) return false;
  return true;
}

/**
 * First-cut Phase 5 table. Kinds with no structural anchor in `CallSite` data today
 * (`deep-link`, `mobile-input`, `message-queue`, `external-api-response`, `database-result`
 * without an established ORM-call convention; `filesystem`/`redirect`/`network-request`/
 * `deserialization`/`logging`/`database-operation` sinks beyond the ones below) are deliberately
 * absent, per the scoping doc's Non-goals — not a silent omission, a stated gap.
 */
export const TAINT_SIGNATURES: readonly TaintSignature[] = [
  // Sources
  {
    name: "process.env",
    kind: "source",
    taintKind: "environment-variable",
    match: { receiverTextStartsWith: "process.env" },
  },
  {
    name: "req.query",
    kind: "source",
    taintKind: "query-parameter",
    match: { receiverTextStartsWith: "req.query" },
  },
  {
    name: "req.params",
    kind: "source",
    taintKind: "route-parameter",
    match: { receiverTextStartsWith: "req.params" },
  },
  {
    name: "req.body",
    kind: "source",
    taintKind: "request-body",
    match: { receiverTextStartsWith: "req.body" },
  },
  {
    name: "req.headers",
    kind: "source",
    taintKind: "header",
    match: { receiverTextStartsWith: "req.headers" },
  },
  {
    name: "req.cookies",
    kind: "source",
    taintKind: "cookie",
    match: { receiverTextStartsWith: "req.cookies" },
  },
  {
    name: "fs.readFile",
    kind: "source",
    taintKind: "file",
    match: { calleeKind: "member", receiverText: "fs", calleeNames: ["readFile", "readFileSync"] },
  },

  // Sinks
  {
    name: "eval",
    kind: "sink",
    taintKind: "eval",
    match: { calleeKind: "identifier", calleeName: "eval" },
  },
  {
    name: "child_process.exec",
    kind: "sink",
    taintKind: "shell-command",
    match: { calleeKind: "member", receiverText: "child_process", calleeNames: ["exec", "execSync"] },
  },
  {
    name: "db-client.query",
    kind: "sink",
    taintKind: "sql",
    match: { calleeKind: "member", calleeName: "query", receiverTextEndsWithAny: ["db", "pool", "connection", "client", "conn"] },
  },
  {
    name: "template.render",
    kind: "sink",
    taintKind: "html-render",
    match: { calleeKind: "member", calleeName: "render" },
  },

  // Sanitizers
  {
    name: "escapeHtml",
    kind: "sanitizer",
    match: { calleeName: "escapeHtml" },
  },
  {
    name: "parseInt",
    kind: "sanitizer",
    match: { calleeKind: "identifier", calleeName: "parseInt" },
  },
  {
    name: "mysql.escape",
    kind: "sanitizer",
    match: { calleeKind: "member", calleeName: "escape" },
  },
] as const;
