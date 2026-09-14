import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AnalyzerConfig } from "../../packages/core/src/index.js";
import { noopLogger } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/project-model");

function configFor(root: string): AnalyzerConfig {
  return {
    root,
    profile: "minimal",
    ignore: { patterns: [], respectGitignore: true },
    incremental: { enabled: false },
    sandbox: { enabled: true, networkAccess: false },
  };
}

function findFile(files: readonly { path: string }[], relativePath: string) {
  const file = files.find((f) => f.path === relativePath);
  if (!file) throw new Error(`fixture file not found in discovery result: ${relativePath}`);
  return file;
}

describe("projectModelDiscoverer / node-express fixture", () => {
  const root = path.join(FIXTURES_ROOT, "node-express");

  it("discovers files, package manager, and the express framework", async () => {
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);

    expect(project.repository.metadata.root).toBe(root);
    expect(project.repository.metadata.isMonorepo).toBe(false);
    expect(project.repository.packages).toHaveLength(1);
    expect(project.repository.packages[0]?.packageManager).toBe("npm");
    expect(project.frameworks).toContain("node");
    expect(project.frameworks).toContain("express");
    expect(project.frameworks).not.toContain("react");

    const index = findFile(project.files, "src/index.js");
    expect(index.language).toBe("javascript");
    expect(index.classification).toBe("source");

    const test = findFile(project.files, "src/index.test.js");
    expect(test.classification).toBe("test");

    const manifest = findFile(project.files, "package.json");
    expect(manifest.classification).toBe("config");
    expect(manifest.language).toBe("json");
  });
});

describe("projectModelDiscoverer / nestjs-app fixture", () => {
  const root = path.join(FIXTURES_ROOT, "nestjs-app");

  it("detects pnpm and the nestjs framework", async () => {
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);
    expect(project.repository.packages[0]?.packageManager).toBe("pnpm");
    expect(project.frameworks).toContain("nestjs");
    expect(project.frameworks).toContain("node");

    const main = findFile(project.files, "src/main.ts");
    expect(main.language).toBe("typescript");
    expect(main.classification).toBe("source");

    const tsconfig = findFile(project.files, "tsconfig.json");
    expect(tsconfig.classification).toBe("config");
  });
});

describe("projectModelDiscoverer / nextjs-app fixture", () => {
  const root = path.join(FIXTURES_ROOT, "nextjs-app");

  it("detects yarn and the nextjs + react frameworks", async () => {
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);
    expect(project.repository.packages[0]?.packageManager).toBe("yarn");
    expect(project.frameworks).toContain("nextjs");
    expect(project.frameworks).toContain("react");

    const page = findFile(project.files, "pages/index.tsx");
    expect(page.language).toBe("typescript");
    expect(page.classification).toBe("source");

    const config = findFile(project.files, "next.config.js");
    expect(config.classification).toBe("config");
  });
});

describe("projectModelDiscoverer / react-native-app fixture", () => {
  const root = path.join(FIXTURES_ROOT, "react-native-app");

  it("detects bun and the react-native + react frameworks", async () => {
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);
    expect(project.repository.packages[0]?.packageManager).toBe("bun");
    expect(project.frameworks).toContain("react-native");
    expect(project.frameworks).toContain("react");

    const app = findFile(project.files, "App.tsx");
    expect(app.language).toBe("typescript");
    expect(app.classification).toBe("source");

    const lockfile = findFile(project.files, "bun.lockb");
    expect(lockfile.encoding).toBe("binary");
  });
});

describe("projectModelDiscoverer / monorepo-pnpm fixture", () => {
  const root = path.join(FIXTURES_ROOT, "monorepo-pnpm");

  it("resolves the pnpm-workspace.yaml glob into two workspace packages", async () => {
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);

    expect(project.repository.metadata.isMonorepo).toBe(true);
    expect(project.repository.packages).toHaveLength(2);
    const names = project.repository.packages.map((p) => p.name).sort();
    expect(names).toEqual(["@fixture-monorepo/api", "@fixture-monorepo/web"]);
    expect(project.repository.packages.every((p) => p.packageManager === "pnpm")).toBe(true);

    expect(project.frameworks).toContain("express");
    expect(project.frameworks).toContain("react");

    findFile(project.files, "packages/api/src/server.js");
    findFile(project.files, "packages/web/src/App.jsx");
  });
});

describe("projectModelDiscoverer / monorepo-pnpm-gaps fixture (regression)", () => {
  const root = path.join(FIXTURES_ROOT, "monorepo-pnpm-gaps");

  it("resolves every glob in pnpm-workspace.yaml's packages: list even across a comment and a blank line", async () => {
    // Regression test: readPnpmWorkspaceGlobs used to `break` on the first non-list-item line,
    // silently dropping every glob after a blank line or a `# comment` inside the `packages:`
    // list. This fixture's pnpm-workspace.yaml has exactly that shape (packages/* — comment —
    // blank line — apps/*) and must still resolve all 3 workspace packages.
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);

    expect(project.repository.packages).toHaveLength(3);
    const names = project.repository.packages.map((p) => p.name).sort();
    expect(names).toEqual(["@fixture-gaps/api", "@fixture-gaps/cli", "@fixture-gaps/web"]);
  });
});

describe("projectModelDiscoverer / generated-code fixture", () => {
  const root = path.join(FIXTURES_ROOT, "generated-code");

  it("classifies generated, infrastructure, test-adjacent, sql, and documentation files correctly", async () => {
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);

    expect(findFile(project.files, "dist/index.js").classification).toBe("generated");
    expect(findFile(project.files, "src/api.generated.ts").classification).toBe("generated");
    expect(findFile(project.files, "src/index.ts").classification).toBe("source");

    const dockerfile = findFile(project.files, "Dockerfile");
    expect(dockerfile.language).toBe("dockerfile");
    expect(dockerfile.classification).toBe("infrastructure");

    expect(findFile(project.files, ".github/workflows/ci.yml").classification).toBe("infrastructure");

    const migration = findFile(project.files, "migrations/001_init.sql");
    expect(migration.language).toBe("sql");
    expect(migration.classification).toBe("source");

    expect(findFile(project.files, "README.md").classification).toBe("documentation");
    expect(project.repository.packages[0]?.packageManager).toBe("npm");

    const vendored = findFile(project.files, "vendor/lib.js");
    expect(vendored.classification).toBe("vendored");

    const asset = findFile(project.files, "src/logo.svg");
    expect(asset.classification).toBe("asset");

    const unrecognized = findFile(project.files, "scripts/deploy.rb");
    expect(unrecognized.language).toBe("unknown");
    expect(unrecognized.classification).toBe("unknown");
  });

  it("produces a deterministic file list and content hashes across repeated discovery runs", async () => {
    const first = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);
    const second = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);

    expect(second.files.map((f) => f.path)).toEqual(first.files.map((f) => f.path));
    expect(second.files.map((f) => f.contentHash)).toEqual(first.files.map((f) => f.contentHash));
  });
});

describe("projectModelDiscoverer / angular-app fixture", () => {
  const root = path.join(FIXTURES_ROOT, "angular-app");

  it("detects the angular framework from an @angular/core dependency", async () => {
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);

    expect(project.frameworks).toContain("angular");
    expect(project.frameworks).toContain("node");
    expect(project.frameworks).not.toContain("vue");
    expect(project.frameworks).not.toContain("react");

    const component = findFile(project.files, "src/app.component.ts");
    expect(component.language).toBe("typescript");
    expect(component.classification).toBe("source");
  });
});

describe("projectModelDiscoverer / vue-app fixture", () => {
  const root = path.join(FIXTURES_ROOT, "vue-app");

  it("detects the vue framework from a vue dependency", async () => {
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);

    expect(project.frameworks).toContain("vue");
    expect(project.frameworks).toContain("node");
    expect(project.frameworks).not.toContain("angular");
    expect(project.frameworks).not.toContain("react");

    const main = findFile(project.files, "src/main.ts");
    expect(main.language).toBe("typescript");
    expect(main.classification).toBe("source");
  });
});

describe("projectModelDiscoverer / python-flask fixture (ADR-0009)", () => {
  const root = path.join(FIXTURES_ROOT, "python-flask");

  it("classifies .py files as python source/test and detects pip from requirements.txt", async () => {
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);

    const app = findFile(project.files, "app.py");
    expect(app.language).toBe("python");
    expect(app.classification).toBe("source");

    const test = findFile(project.files, "test_app.py");
    expect(test.classification).toBe("test"); // pytest's own test_*.py convention

    const requirements = findFile(project.files, "requirements.txt");
    expect(requirements.classification).toBe("config");

    expect(project.repository.packages[0]?.packageManager).toBe("pip");
    expect(project.repository.packages).toHaveLength(1);
  });
});

describe("projectModelDiscoverer / python-config-files fixture (regression: requirements.txt config-vs-documentation)", () => {
  // Regression test for classify.ts's CONFIG_FILENAMES check being moved before the
  // documentation-extension check (requirements.txt was previously misclassified as
  // documentation because ".txt" is a DOCUMENTATION_EXTENSIONS entry). Covers every
  // Python-ecosystem filename added to CONFIG_FILENAMES alongside that fix, not just
  // requirements.txt (already covered by the python-flask fixture above).
  const root = path.join(FIXTURES_ROOT, "python-config-files");

  it("classifies pyproject.toml, setup.cfg, and pipfile as config, not documentation/unknown", async () => {
    const project = await projectModelDiscoverer.discover(root, configFor(root), noopLogger);

    expect(findFile(project.files, "pyproject.toml").classification).toBe("config");
    expect(findFile(project.files, "setup.cfg").classification).toBe("config");
    expect(findFile(project.files, "pipfile").classification).toBe("config");

    const app = findFile(project.files, "app.py");
    expect(app.language).toBe("python");
    expect(app.classification).toBe("source");

    expect(project.repository.packages[0]?.packageManager).toBe("poetry");
  });
});
