# @code-analyzer/api

HTTP API exposing `@code-analyzer/core`'s `AnalyzerClient`/`ScanEngine` pipeline: upload a code
archive, run the same analysis `@code-analyzer/cli`'s `scan` command runs, get back a `ScanResult`
— optionally streamed as Server-Sent Events. Contains no analysis logic of its own; see
`docs/project-status.md` and ADR-0012 for how it fits the rest of the platform.

## Scope

Each request is a self-contained scan: upload code, get results back, nothing persisted. No web
UI, no mobile app, no database/history, no auth/user accounts, no git-URL fetching. Those are
explicitly left to a separate, future project that consumes this API — see the plan this package
was built from for the full rationale.

## Endpoints

- `GET /v1/health` — liveness check.
- `POST /v1/scans` — upload a `.zip` archive (or individual files) as a multipart field, run a
  full scan against it, and get back the `ScanResult` JSON.
- `POST /v1/scans?stream=true` — same upload/scan, but the response is
  `text/event-stream`: one SSE frame per scan lifecycle event (`scan:started`, `stage:started`,
  `stage:completed`, `analyzer:started`, `finding:emitted`, `analyzer:completed`,
  `stage:completed`, `scan:completed`), followed by a final `event: result` frame carrying the full
  `ScanResult`.

## Running it

```bash
pnpm --filter @code-analyzer/api build
PORT=3000 node packages/api/dist/bin.js
```

## Example requests

```bash
curl -X POST http://localhost:3000/v1/scans \
  -F "archive=@./my-repo.zip;type=application/zip" | jq '.summary'

curl -N -X POST "http://localhost:3000/v1/scans?stream=true" \
  -F "archive=@./my-repo.zip;type=application/zip"
```

## Security

See `SECURITY.md` in this package and `docs/security/overview.md`.
