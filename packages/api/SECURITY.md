# Security notes for @code-analyzer/api

This package is the first network-facing surface in this repository — it accepts arbitrary
uploaded archives from potentially untrusted callers. It inherits the repository's core security
requirement (`docs/security/overview.md`, Section 31): **scanned repository content is untrusted
input and is never executed in-process.** Everything below is additional to that baseline, specific
to being reachable over the network.

## No code execution, ever

`scan/run-scan.ts` hardcodes `sandbox: { enabled: true, networkAccess: false }` and does not read
sandbox settings from the request. The pipeline it wires (`projectModelDiscoverer` +
`graphProjectIndexer` + the built-in `@code-analyzer/analyzers` set) only discovers, parses, and
statically analyzes files — nothing in this path runs `eval`, spawns the uploaded code, or executes
a build/test step.

## Untrusted archive handling

- **Per-request isolation**: every request gets its own `mkdtemp`-created workspace
  (`upload/workspace.ts`), never shared across concurrent requests, deleted unconditionally in a
  `finally` block. A startup sweep (`bin.ts`) removes any workspace left behind by a crashed
  process.
- **Zip-slip guard**: `upload/zip-extract.ts` resolves every entry path against the workspace root
  and rejects any entry that would resolve outside it, before writing anything to disk.
- **Zip-bomb guards**: per-entry and total uncompressed-size ceilings (`config/limits.ts`),
  checked against both the archive's declared sizes and the actual bytes written as each entry is
  streamed out — a lying header doesn't bypass the cap.
- **Symlink entries are never materialized** — skipped entirely, so an archive can't plant a
  symlink pointing outside the workspace.
- **Entry-count cap** prevents an archive with an excessive number of tiny entries from exhausting
  inodes/time.
- **Upload size cap** is enforced both by `@fastify/multipart`'s own `limits.fileSize` and again
  while streaming the part to disk, independent of any `Content-Length` the client claims.

## Abuse controls

- **Rate limiting** (`@fastify/rate-limit`, per-IP) — the only practical abuse control available in
  this slice, since it has no authentication/user model yet.
- **Scan timeout** (`config/limits.ts`'s `scanTimeoutMs`) is wired through the engine's existing
  `AbortSignal` support (`ScanOptions.signal`) so a pathological input can't hang a worker
  indefinitely.
- **Uploads only** — this API never fetches a remote URL or git repository on the caller's behalf,
  which keeps `networkAccess: false` meaningful and avoids an SSRF surface.

## What this package does not provide

No authentication, no per-user quotas beyond the flat rate limit, no request signing, no audit log.
A production deployment fronting this API with real user identity, quotas, and audit logging is
expected to live in the separate consuming project this API is built for — see this package's
README for the explicit scope boundary.
