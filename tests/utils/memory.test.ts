import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const homedirMock = vi.hoisted(() => vi.fn());
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: homedirMock };
});

const {
  readMemoryIndex,
  writeMemoryIndex,
  readTrend,
  appendTrend,
  ensureMemoryStore,
  legacyMemoryDir,
} = await import("../../src/utils/memory.js");
const { writeFile, memoryDir } = await import("../../src/utils/fs.js");

let tmp: string;
const originalDshHome = process.env.DSH_HOME;

const sampleIndex = {
  note: "qa memory",
  staleAfterDays: 30,
  files: { "trend.json": "pass-rate trend" },
  lastUpdated: "2026-01-01T00:00:00.000Z",
  lastUpdateNote: "init",
};

const samplePoint = {
  runId: "run-1",
  date: "2026-01-01T00:00:00.000Z",
  feature: "Checkout",
  env: "qa",
  total: 10,
  passed: 9,
  failed: 1,
  skipped: 0,
  durationMs: 1234,
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qa-agent-mem-"));
  homedirMock.mockReturnValue(tmp);
  delete process.env.DSH_HOME;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (originalDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = originalDshHome;
});

describe("memory index", () => {
  it("returns null when no index has been written", () => {
    expect(readMemoryIndex()).toBeNull();
  });

  it("round-trips an index through write and read", () => {
    writeMemoryIndex(sampleIndex);

    expect(readMemoryIndex()).toEqual(sampleIndex);
  });

  it("writes the index as pretty-printed JSON", () => {
    writeMemoryIndex(sampleIndex);

    const raw = readFileSync(join(memoryDir(), "index.json"), "utf-8");
    expect(raw).toContain("\n  ");
  });

  it("returns null rather than throwing on corrupt JSON", () => {
    writeFile(join(memoryDir(), "index.json"), "{ not json");

    expect(readMemoryIndex()).toBeNull();
  });
});

describe("trend store", () => {
  it("returns an empty array when no trend file exists", () => {
    expect(readTrend()).toEqual([]);
  });

  it("returns an empty array rather than throwing on corrupt JSON", () => {
    writeFile(join(memoryDir(), "trend.json"), "][");

    expect(readTrend()).toEqual([]);
  });

  it("appends a point to an empty store", () => {
    appendTrend(samplePoint);

    expect(readTrend()).toEqual([samplePoint]);
  });

  it("appends distinct run ids in order", () => {
    appendTrend(samplePoint);
    appendTrend({ ...samplePoint, runId: "run-2" });

    expect(readTrend().map(p => p.runId)).toEqual(["run-1", "run-2"]);
  });

  it("deduplicates on runId and keeps the first write", () => {
    appendTrend(samplePoint);
    appendTrend({ ...samplePoint, passed: 0, failed: 10 });

    const trends = readTrend();
    expect(trends).toHaveLength(1);
    expect(trends[0].passed).toBe(9);
  });
});

describe("ensureMemoryStore", () => {
  it("creates the memory and snapshots directories", () => {
    ensureMemoryStore();

    expect(existsSync(memoryDir())).toBe(true);
    expect(existsSync(join(memoryDir(), "snapshots"))).toBe(true);
  });

  it("is safe to call twice", () => {
    ensureMemoryStore();

    expect(() => ensureMemoryStore()).not.toThrow();
  });
});

describe("legacyMemoryDir", () => {
  it("defaults to ~/.dsh/qa-memory", () => {
    expect(legacyMemoryDir()).toBe(join(tmp, ".dsh", "qa-memory"));
  });

  it("honours the DSH_HOME override", () => {
    process.env.DSH_HOME = join(tmp, "custom-dsh");

    expect(legacyMemoryDir()).toBe(join(tmp, "custom-dsh", "qa-memory"));
  });
});
