/**
 * @code-analyzer/integrations — Section 23/33 external tool and CI/CD integration.
 *
 * Test coverage ingestion (ADR-0010 Track A) is the first real content: normalizes LCOV,
 * Istanbul (`coverage-final.json`), and coverage.py JSON reports into `CoverageModel`. All other
 * integrations (CodeQL, Semgrep, OSV, Trivy, Gitleaks, SARIF, CI/CD adapters) remain unimplemented
 * until their own phase's task spec is approved.
 */
export * from "./coverage/lcov.js";
export * from "./coverage/istanbul-json.js";
export * from "./coverage/coverage-py.js";
export * from "./coverage/build-model.js";
export * from "./coverage/map-file.js";
