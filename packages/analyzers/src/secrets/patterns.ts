/**
 * v1 secret patterns. Regex-only by nature — there is no AST/graph representation of "this string
 * literal happens to match a live-credential shape" (Section 7's AST/symbol/call-graph/data-flow
 * preference doesn't apply here; this mirrors how gitleaks/trufflehog work industry-wide). Kept
 * deliberately small and high-precision: a noisy secrets scanner trains reviewers to ignore it.
 *
 * `confidence` is honest about what a shape-match alone proves (Section on FindingStatus, ADR-0004):
 * none of these confirm the credential is live, so status is always "detected", never "confirmed".
 */
export interface SecretPattern {
  readonly id: string;
  readonly name: string;
  readonly regex: RegExp;
  readonly cwe: string;
  readonly confidence: number;
  readonly descriptionTemplate: string;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: "secrets/aws-access-key-id",
    name: "AWS Access Key ID",
    regex: /AKIA[0-9A-Z]{16}/g,
    cwe: "CWE-798",
    confidence: 0.75,
    descriptionTemplate: "A string matching the AWS Access Key ID shape (AKIA + 16 alphanumeric characters) was found in source.",
  },
  {
    id: "secrets/github-token",
    name: "GitHub Token",
    regex: /gh[pousr]_[A-Za-z0-9]{36}/g,
    cwe: "CWE-798",
    confidence: 0.8,
    descriptionTemplate: "A string matching a GitHub personal/OAuth/app token shape was found in source.",
  },
  {
    id: "secrets/slack-token",
    name: "Slack Token",
    regex: /xox[baprs]-[0-9A-Za-z-]{10,}/g,
    cwe: "CWE-798",
    confidence: 0.7,
    descriptionTemplate: "A string matching a Slack token shape (xoxb/xoxp/xoxa/xoxr/xoxs prefix) was found in source.",
  },
  {
    id: "secrets/private-key-header",
    name: "Private Key Header",
    regex: /-----BEGIN (RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/g,
    cwe: "CWE-798",
    confidence: 0.8,
    descriptionTemplate: "A PEM private key header was found in source, indicating an embedded private key.",
  },
  {
    id: "secrets/google-api-key",
    name: "Google API Key",
    regex: /AIza[0-9A-Za-z\-_]{35}/g,
    cwe: "CWE-798",
    confidence: 0.65,
    descriptionTemplate: "A string matching the Google API key shape (AIza + 35 characters) was found in source.",
  },
  {
    id: "secrets/stripe-live-secret-key",
    // Body charset intentionally includes `_` even though real Stripe secret keys are pure
    // alnum — this is strictly a superset (still matches every real key), and the extra
    // character lets our own security fixtures (fixtures/security/secrets/vulnerable/stripe.ts)
    // contain an obviously-fake, non-functional value that doesn't collide byte-for-byte with
    // GitHub push protection's real (stricter, alnum-only) Stripe-key pattern — see ADR-0011's
    // "never commit anything shaped like a live credential" note and Section 56.
    name: "Stripe Live Secret Key",
    regex: /sk_live_[0-9A-Za-z_]{24,}/g,
    cwe: "CWE-798",
    confidence: 0.8,
    descriptionTemplate: "A string matching a Stripe live secret key shape (sk_live_ prefix) was found in source.",
  },
];
