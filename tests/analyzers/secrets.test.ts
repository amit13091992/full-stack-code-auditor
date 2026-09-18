import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { secretsAnalyzer } from "../../packages/analyzers/src/index.js";
import { SECRET_PATTERNS } from "../../packages/analyzers/src/secrets/patterns.js";
import { buildAnalyzerContext } from "./test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/security/secrets");

const RAW_SECRETS = [
  "AKIAABCDEFGHIJKLMNOP",
  "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
  "xoxb-FAKE-NOTREAL-TESTTOKEN-PLACEHOLDERVALUE000",
  "-----BEGIN RSA PRIVATE KEY-----",
  "AIzaSyAbcdefGhijkLmnopQrstuVwxyz0123456",
  "sk_live_NOTAREAL_STRIPE_KEY_FAKEVALUE_PLACEHOLDER",
];

function findingsAsSearchableText(findings: readonly { title: string; description: string }[], evidence: readonly { summary: string }[]): string {
  return [...findings.map((f) => `${f.title} ${f.description}`), ...evidence.map((e) => e.summary)].join("\n");
}

describe("secrets/pattern-scan", () => {
  it("flags every pattern in the vulnerable fixture directory", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "vulnerable"));
    const result = await secretsAnalyzer.analyze(context);

    const foundRuleIds = new Set(result.findings.map((f) => f.ruleId));
    for (const pattern of SECRET_PATTERNS) {
      expect(foundRuleIds.has(pattern.id)).toBe(true);
    }
  });

  it("does not flag near-miss strings in the safe fixture directory", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "safe"));
    const result = await secretsAnalyzer.analyze(context);

    expect(result.findings).toHaveLength(0);
  });

  it("reports honest, non-confirmed metadata for every finding", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "vulnerable"));
    const result = await secretsAnalyzer.analyze(context);

    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.category).toBe("secrets");
      expect(finding.severity).toBe("critical");
      expect(finding.status).toBe("detected");
      expect(finding.confidence).toBeGreaterThanOrEqual(0.6);
      expect(finding.confidence).toBeLessThanOrEqual(0.8);
      expect(finding.cwe).toBe("CWE-798");
      expect(finding.description).toContain("not a verified-live-credential check");
    }
  });

  it("never leaks the raw matched secret into any Finding or Evidence field", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "vulnerable"));
    const result = await secretsAnalyzer.analyze(context);

    const text = findingsAsSearchableText(result.findings, result.evidence);
    for (const secret of RAW_SECRETS) {
      expect(text).not.toContain(secret);
    }
    for (const finding of result.findings) {
      expect(finding.description).toContain("REDACTED");
    }
  });

  it("skips files above the size cap and binary-encoded files without crashing, and reports why via diagnostics", async () => {
    const context = await buildAnalyzerContext(path.join(FIXTURES_ROOT, "vulnerable"));
    const oversizedFile = {
      ...context.project.files[0]!,
      absolutePath: path.join(FIXTURES_ROOT, "vulnerable", "aws.ts"),
      sizeBytes: 6 * 1024 * 1024,
    };
    const binaryFile = {
      ...context.project.files[0]!,
      absolutePath: path.join(FIXTURES_ROOT, "vulnerable", "aws.ts"),
      encoding: "binary" as const,
    };
    const patchedContext = {
      ...context,
      project: { ...context.project, files: [oversizedFile, binaryFile] },
    };

    const result = await secretsAnalyzer.analyze(patchedContext);
    expect(result.findings).toHaveLength(0);
    // A clean result must be distinguishable from "everything was actually scanned" (ADR-0004) —
    // both skip reasons should surface as diagnostics, not disappear silently.
    const diagnosticMessages = result.diagnostics.map((d) => d.message).join("\n");
    expect(diagnosticMessages).toMatch(/exceeds the .*size limit/);
    expect(diagnosticMessages).toMatch(/classified as binary/);
  });

  describe("path traversal via symlink", () => {
    let tmpRoot: string;

    afterEach(() => {
      if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("does not follow a symlink under the scan root to read a file outside it", async () => {
      tmpRoot = mkdtempSync(path.join(tmpdir(), "secrets-symlink-"));
      const scanRoot = path.join(tmpRoot, "repo");
      const outsideDir = path.join(tmpRoot, "outside");
      const outsideSecretFile = path.join(outsideDir, "outside-secret.ts");
      const outsideOnlySecret = "AKIAZZZZZZZZZZZZZZZZ";

      mkdirSync(scanRoot, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(outsideSecretFile, `export const KEY = "${outsideOnlySecret}";\n`, "utf-8");

      const linkPath = path.join(scanRoot, "escape.ts");
      symlinkSync(outsideSecretFile, linkPath);

      const context = await buildAnalyzerContext(scanRoot);
      const symlinkedFile = {
        ...context.project.files[0]!,
        path: "escape.ts",
        absolutePath: linkPath,
        sizeBytes: 100,
        encoding: "utf-8" as const,
      };
      const patchedContext = {
        ...context,
        project: { ...context.project, files: [symlinkedFile] },
      };

      const result = await secretsAnalyzer.analyze(patchedContext);

      expect(result.findings).toHaveLength(0);
      const text = findingsAsSearchableText(result.findings, result.evidence);
      expect(text).not.toContain(outsideOnlySecret);
      const diagnosticMessages = result.diagnostics.map((d) => d.message).join("\n");
      expect(diagnosticMessages).toMatch(/outside the scan root/);
    });
  });

  it("fixture files really do contain the raw secrets on disk (sanity check the test isn't vacuous)", () => {
    const awsPath = path.join(FIXTURES_ROOT, "vulnerable", "aws.ts");
    expect(statSync(awsPath).isFile()).toBe(true);
    const content = readFileSync(awsPath, "utf-8");
    expect(content).toContain("AKIAABCDEFGHIJKLMNOP");
  });
});
