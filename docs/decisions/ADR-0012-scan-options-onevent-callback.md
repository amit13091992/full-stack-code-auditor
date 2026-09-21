# ADR-0012: `ScanOptions.onEvent` — External Subscriber to Scan Lifecycle Events

## Status

Accepted (amit13091992@gmail.com)

## Context

`ScanEngine.scan()` (`packages/core/src/analyzer/engine.ts`) creates its own `SimpleEventEmitter`
internally and emits `ScanEvent`s (`scan:started`, `stage:started`/`stage:completed`,
`analyzer:started`/`analyzer:completed`, `finding:emitted`, `scan:completed`/`scan:cancelled`/
`scan:failed` — `packages/core/src/events/events.ts`) throughout the pipeline. Today the only
consumer of this emitter is `AnalyzerContext.events`, handed to `Analyzer.analyze()` implementations
— it is never exposed outside the engine's own invocation of `scan()`.

`packages/api` (a new package exposing the existing `AnalyzerClient`/`ScanEngine` pipeline over
HTTP — see `docs/tasks/` and `docs/project-status.md`) needs to stream scan progress to an external
HTTP client over Server-Sent Events as a scan runs, rather than only returning the final
`ScanResult`. That requires a way to observe `ScanEvent`s from outside an `Analyzer` — a case this
contract does not support today.

### Consumers inspected (Section 46)

Grepped `ScanOptions`/`options.signal`/`SimpleEventEmitter`/`events.on`/`events.emit` across
`packages/*/src`:

- `packages/core/src/config/scan-options.ts` — defines `ScanOptions` (this change).
- `packages/core/src/analyzer/engine.ts` — `ScanEngine.scan()` constructs the `SimpleEventEmitter`
  and is the only place that can subscribe an external listener to it.
- `packages/cli/src/commands/scan.ts` — calls `client.scan(...)` without `onEvent`; unaffected,
  since the new field is optional.
- `tests/core/scan-engine.test.ts` — fixture callers of `client.scan(options)`; unaffected unless
  they opt in to the new field.

No other package reads `ScanOptions` or constructs a `ScanEngine` directly.

## Decision

- **Add one optional field to `ScanOptions`**: `readonly onEvent?: ScanEventListener`
  (`ScanEventListener` is already a public type exported from `packages/core/src/events/events.ts`
  — no new type is introduced).
- **`ScanEngine.scan()` subscribes it to the same internal emitter analyzers already see**, right
  after constructing `SimpleEventEmitter`:

  ```ts
  const events = new SimpleEventEmitter();
  if (options.onEvent) events.on(options.onEvent);
  ```

  The external subscriber receives the exact same event sequence, in the same order, as
  `AnalyzerContext.events` — no filtering, no separate event stream, no new event types.
- **Purely additive and optional**: existing callers (the CLI, existing tests) that don't pass
  `onEvent` see no behavior change at all.

## Alternatives considered

- **Return an `EventEmitter`/async iterator from `scan()` instead of accepting a callback.**
  Rejected: would change `scan()`'s return type (currently `Promise<ScanResult>`), a much larger
  and non-additive contract change, for a capability a plain optional callback already provides.
- **A separate `subscribe(listener)` method on `ScanEngine`/`AnalyzerClient` outside `scan()`.**
  Rejected: `ScanEngine` builds a fresh `SimpleEventEmitter` per call to `scan()` (Section 37D — each
  scan is independent), so a pre-registered subscription has no natural lifecycle to attach to
  without introducing per-scan-id subscription bookkeeping the engine doesn't otherwise need.
  Passing the listener into the same call that starts the scan keeps the emitter's lifecycle exactly
  as scoped as it is today.
- **Expose the internal `SimpleEventEmitter` type/instance directly.** Rejected: `SimpleEventEmitter`
  is a private implementation detail of `engine.ts`; exposing it would leak internals wholesale
  instead of the minimal callback surface `packages/api` actually needs (Section 35.13 — don't build
  more than the consuming phase requires).

## Consequences

- `packages/api`'s SSE endpoint can pass `onEvent: (event) => writeSseFrame(event)` straight into
  `client.scan({ onEvent })` and reuse the engine's existing event model verbatim, with no
  duplicate event-modeling work and no new `ScanResult` field.
- This is the first time an external package (not just `Analyzer` implementations) observes
  `ScanEngine` internals during a run, which is why this required an ADR rather than a silent
  optional-field addition — but the field itself does not change `ScanEngine`'s stage model, event
  types, or emission order in any way.
- No change to `packages/core`'s zero-workspace-dependency rule, no new third-party dependency, no
  new package created by this ADR (that's tracked separately as the `packages/api` scaffolding work).
