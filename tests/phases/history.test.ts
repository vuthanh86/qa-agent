import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: execSyncMock, spawn: vi.fn() }));

const homedirMock = vi.hoisted(() => vi.fn());
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: homedirMock };
});

const { runHistory } = await import("../../src/phases/history.js");

let tmp: string;
const originalDshHome = process.env.DSH_HOME;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qa-agent-history-"));
  homedirMock.mockReturnValue(tmp);
  execSyncMock.mockReset();
  delete process.env.DSH_HOME;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (originalDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = originalDshHome;
});

describe("legacy renderer delegation", () => {
  it("returns the expected artifact paths", () => {
    execSyncMock.mockReturnValue("");

    const result = runHistory({ outDir: tmp });

    expect(result.htmlPath).toBe(join(tmp, "history.html"));
    expect(result.mermaidPath).toBe(join(tmp, "history.mmd"));
  });

  it("invokes the legacy renderer under the default DSH home", () => {
    execSyncMock.mockReturnValue("");

    runHistory({ outDir: tmp });

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain(join(tmp, ".dsh", "qa-agent", "scripts", "render-qa-history.mjs"));
    expect(cmd).toContain(`--outDir ${tmp}`);
    expect(cmd).toContain("--last 50");
  });

  it("honours the DSH_HOME override when locating the legacy renderer", () => {
    process.env.DSH_HOME = join(tmp, "custom");
    execSyncMock.mockReturnValue("");

    runHistory({ outDir: tmp });

    expect(execSyncMock.mock.calls[0][0]).toContain(join(tmp, "custom", "qa-agent"));
  });

  it("passes feature, env and last through to the renderer", () => {
    execSyncMock.mockReturnValue("");

    runHistory({ outDir: tmp, feature: "Checkout", env: "staging", last: 30 });

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).toContain("--last 30");
    expect(cmd).toContain("--feature Checkout");
    expect(cmd).toContain("--env staging");
  });

  it("omits feature and env flags when they are not supplied", () => {
    execSyncMock.mockReturnValue("");

    runHistory({ outDir: tmp });

    const cmd = execSyncMock.mock.calls[0][0] as string;
    expect(cmd).not.toContain("--feature");
    expect(cmd).not.toContain("--env");
  });

  it("does not write fallback artifacts when the legacy renderer succeeds", () => {
    execSyncMock.mockReturnValue("");

    runHistory({ outDir: tmp });

    expect(existsSync(join(tmp, "history.html"))).toBe(false);
  });
});

describe("minimal fallback renderer", () => {
  beforeEach(() => {
    execSyncMock.mockImplementation(() => {
      throw new Error("renderer not installed");
    });
  });

  it("writes a standalone HTML report when the legacy renderer is unavailable", () => {
    runHistory({ outDir: tmp, feature: "Checkout", env: "qa" });

    const html = readFileSync(join(tmp, "history.html"), "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("QA History Graph");
    expect(html).toContain("Feature: Checkout | Env: qa | Last 50 runs");
  });

  it("writes a Mermaid sidecar", () => {
    runHistory({ outDir: tmp, feature: "Checkout", env: "qa" });

    const mmd = readFileSync(join(tmp, "history.mmd"), "utf-8");
    expect(mmd).toContain("graph TD");
    expect(mmd).toContain("Checkout / qa");
  });

  it("labels missing feature and env as 'all'", () => {
    runHistory({ outDir: tmp });

    const html = readFileSync(join(tmp, "history.html"), "utf-8");
    expect(html).toContain("<title>QA History — all / all</title>");
    expect(html).toContain("Feature: all | Env: all");
  });

  it("reflects a custom run limit in the fallback output", () => {
    runHistory({ outDir: tmp, last: 5 });

    expect(readFileSync(join(tmp, "history.html"), "utf-8")).toContain("Last 5 runs");
  });

  it("suggests sensible defaults in the install hint", () => {
    runHistory({ outDir: tmp });

    const html = readFileSync(join(tmp, "history.html"), "utf-8");
    expect(html).toContain('--feature "default"');
    expect(html).toContain('--env "qa"');
  });
});
