# Security Subsystem Shape

Section 7 requires the Security Engine to be a first-class subsystem (Injection, Authentication,
Authorization, Session, Secrets, Cryptography, Input Validation, File Security, API Security,
Configuration Security, Data Exposure), not a bag of unrelated rules. Phase 0 fixes the contracts
this subsystem will be built on; it implements none of the actual detection logic.

## Contracts already in `packages/core` that security analyzers will use

- `DataFlow` / `TaintNode` / `TaintStep` (`domain/data-flow.ts`) — source-to-sink path
  reconstruction (Section 6), with `TaintSourceKind` and `TaintSinkKind` enumerating the Section 6
  source/sink lists verbatim (HTTP request, query/route params, body, headers, cookies, files, env
  vars, deep links, mobile input, DB results, message queues, external API responses / SQL, shell,
  filesystem, HTML render, redirect, network request, eval, deserialization, logging, DB ops).
- `AuthenticationModel` / `AuthorizationModel` (`domain/auth.ts`) — deliberately minimal in Phase 0
  (Section 8/9 full reasoning — role/permission/resource/ownership/tenant modeling — is Phase 6+
  work); these exist now only so `EndpointModel.authentication`/`.authorization` have a type.
- `Evidence.kind` includes `ast-pattern | symbol-resolution | call-graph-path | data-flow-path` —
  the four ways a security finding is expected to justify itself (Section 7: "Whenever possible use
  AST + symbol resolution + call graph + data flow + security metadata", explicitly not
  string-matching alone).
- `Finding.cwe` / `Finding.owasp` — CWE/OWASP mapping fields exist on every finding, not just
  security ones, so correlation (Section 21) can group across categories that happen to share a CWE.

## What is explicitly out of scope for Phase 0

- Any concrete rule for SQL injection, XSS, SSRF, path traversal, IDOR, JWT handling, etc.
  (Section 7's vulnerability list) — these are `packages/analyzers` implementations, gated on the
  taint engine (`packages/graph`, Phase 5) existing first.
- Secrets detection signals (pattern/entropy/context/provider-signature/git-history, Section 14) —
  no `SecretFinding`-specific type exists yet; Section 14 findings will use the generic `Finding`
  with `category: "secrets"` until a real need for secrets-specific fields is demonstrated.
- Infrastructure exposure modeling (Section 15) — see the Known Gaps note in
  `docs/architecture/overview.md`.

## Process note (Section 47)

Once implementation starts, any change touching authentication, authorization, taint, security
rules, sandboxing, secret handling, dependency scanning, or runtime execution must go through:
implementation → unit tests → security fixture tests → regression tests → architecture review →
security review, in that order. This applies from the first `packages/analyzers/src/security/*`
file onward, not just to "big" changes.
