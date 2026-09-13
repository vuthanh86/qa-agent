import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const execSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: execSyncMock }));

const homedirMock = vi.hoisted(() => vi.fn());
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: homedirMock };
});

const {
  isAgentBrowserAvailable,
  snapshotDir,
  saveSnapshot,
  restoreSnapshot,
  listSnapshots,
} = await import("../../src/snapshot/index.js");
const { writeFile, ensureDir } = await import("../../src/utils/fs.js");

let tmp: string;

/** Route agent-browser subcommands to canned stdout; unknown commands return "". */
function stubAgentBrowser(responses: Record<string, string> = {}) {
  execSyncMock.mockImplementation((cmd: string) => {
    for (const [fragment, out] of Object.entries(responses)) {
      if (cmd.includes(fragment)) return out;
    }
    return "";
  });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qa-agent-snap-"));
  homedirMock.mockReturnValue(tmp);
  execSyncMock.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("isAgentBrowserAvailable", () => {
  it("returns true when the version probe succeeds", () => {
    execSyncMock.mockReturnValue("");

    expect(isAgentBrowserAvailable()).toBe(true);
    expect(execSyncMock).toHaveBeenCalledWith("agent-browser --version", { stdio: "ignore" });
  });

  it("returns false when agent-browser is not on PATH", () => {
    execSyncMock.mockImplementation(() => { throw new Error("ENOENT"); });

    expect(isAgentBrowserAvailable()).toBe(false);
  });
});

describe("snapshotDir", () => {
  it("namespaces snapshots by feature and env under the memory store", () => {
    expect(snapshotDir("Checkout", "qa")).toBe(
      join(tmp, ".qa-agent", "memory", "snapshots", "Checkout", "qa"),
    );
  });
});

describe("saveSnapshot", () => {
  it("throws when agent-browser is unavailable", () => {
    execSyncMock.mockImplementation(() => { throw new Error("ENOENT"); });

    expect(() => saveSnapshot("login", "Checkout", "qa")).toThrow(/agent-browser is required/);
  });

  it("captures the current URL and a truncated sha256 of the visible text", () => {
    stubAgentBrowser({
      "agent-browser url": "https://qa.example.com/dashboard\n",
      "agent-browser text": "Welcome back\n",
    });

    const info = saveSnapshot("login", "Checkout", "qa");

    const expectedHash = createHash("sha256").update("Welcome back").digest("hex").slice(0, 16);
    expect(info.url).toBe("https://qa.example.com/dashboard");
    expect(info.textHash).toBe(expectedHash);
    expect(info.textHash).toHaveLength(16);
  });

  it("records the snapshot identity fields", () => {
    stubAgentBrowser({ "agent-browser url": "https://qa/x", "agent-browser text": "t" });

    const info = saveSnapshot("login", "Checkout", "qa");

    expect(info.name).toBe("login");
    expect(info.feature).toBe("Checkout");
    expect(info.env).toBe("qa");
    expect(Date.parse(info.timestamp)).not.toBeNaN();
  });

  it("delegates cookie and storage capture to agent-browser", () => {
    stubAgentBrowser({ "agent-browser url": "https://qa/x", "agent-browser text": "t" });

    saveSnapshot("login", "Checkout", "qa");

    const dir = snapshotDir("Checkout", "qa");
    expect(execSyncMock).toHaveBeenCalledWith(
      `agent-browser snapshot save --name "login" --dir "${dir}"`,
      { stdio: "ignore" },
    );
  });

  it("persists the metadata sidecar next to the snapshot", () => {
    stubAgentBrowser({ "agent-browser url": "https://qa/x", "agent-browser text": "t" });

    const info = saveSnapshot("login", "Checkout", "qa");

    const written = JSON.parse(
      readFileSync(join(snapshotDir("Checkout", "qa"), "login.json"), "utf-8"),
    );
    expect(written).toEqual(info);
  });
});

describe("restoreSnapshot", () => {
  it("throws when agent-browser is unavailable", () => {
    execSyncMock.mockImplementation(() => { throw new Error("ENOENT"); });

    expect(() => restoreSnapshot("login", "Checkout", "qa")).toThrow(/agent-browser is required/);
  });

  it("returns null when the named snapshot does not exist", () => {
    stubAgentBrowser();

    expect(restoreSnapshot("missing", "Checkout", "qa")).toBeNull();
  });

  it("returns the stored metadata and delegates the restore", () => {
    const dir = snapshotDir("Checkout", "qa");
    const info = {
      name: "login",
      feature: "Checkout",
      env: "qa",
      url: "https://qa.example.com/dashboard",
      textHash: "abc123",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    writeFile(join(dir, "login.json"), JSON.stringify(info));
    stubAgentBrowser();

    expect(restoreSnapshot("login", "Checkout", "qa")).toEqual(info);
    expect(execSyncMock).toHaveBeenCalledWith(
      `agent-browser snapshot restore --name "login" --dir "${dir}"`,
      { stdio: "ignore" },
    );
  });
});

describe("listSnapshots", () => {
  it("returns an empty array when the snapshot directory does not exist", () => {
    expect(listSnapshots("Checkout", "qa")).toEqual([]);
  });

  it("returns an empty array for an existing but empty directory", () => {
    ensureDir(snapshotDir("Checkout", "qa"));

    expect(listSnapshots("Checkout", "qa")).toEqual([]);
  });

  it("reads every snapshot sidecar in the directory", () => {
    const dir = snapshotDir("Checkout", "qa");
    const a = { name: "a", feature: "Checkout", env: "qa", url: "u1", textHash: "h1", timestamp: "t1" };
    const b = { name: "b", feature: "Checkout", env: "qa", url: "u2", textHash: "h2", timestamp: "t2" };
    writeFile(join(dir, "a.json"), JSON.stringify(a));
    writeFile(join(dir, "b.json"), JSON.stringify(b));

    const snaps = listSnapshots("Checkout", "qa");

    expect(snaps).toHaveLength(2);
    expect(snaps.map(s => s.name).sort()).toEqual(["a", "b"]);
  });

  it("ignores non-JSON files in the directory", () => {
    const dir = snapshotDir("Checkout", "qa");
    writeFile(join(dir, "a.json"), JSON.stringify({ name: "a" }));
    writeFile(join(dir, "notes.txt"), "ignore me");

    expect(listSnapshots("Checkout", "qa")).toHaveLength(1);
  });

  it("skips corrupt sidecars instead of failing the whole listing", () => {
    const dir = snapshotDir("Checkout", "qa");
    writeFile(join(dir, "good.json"), JSON.stringify({ name: "good" }));
    writeFile(join(dir, "bad.json"), "{ not json");

    const snaps = listSnapshots("Checkout", "qa");

    expect(snaps).toHaveLength(1);
    expect(snaps[0].name).toBe("good");
  });
});
