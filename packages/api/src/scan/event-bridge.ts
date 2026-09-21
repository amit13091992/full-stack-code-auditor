import type { ScanEvent } from "@code-analyzer/core";

/** Writes one Server-Sent Events frame. `event` names the SSE event type; `data` is JSON-encoded. */
export function writeSseFrame(write: (chunk: string) => void, event: string, data: unknown): void {
  write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Bridges a `ScanEvent` into an SSE frame using the event's own `type` as the SSE event name. */
export function scanEventToSse(write: (chunk: string) => void, event: ScanEvent): void {
  writeSseFrame(write, event.type, event);
}
