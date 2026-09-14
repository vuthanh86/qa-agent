import { describe, it, expect, vi, beforeEach } from "vitest";

/** Availability per platform name, plus a probe log, both driven by the tests. */
const control = vi.hoisted(() => ({
  available: {} as Record<string, boolean>,
  probed: [] as string[],
}));

/** Minimal adapter double that reports availability from the shared control map. */
const fakeAdapter = vi.hoisted(() => (name: string) =>
  class {
    readonly name = name;
    readonly label = `${name} label`;
    async isAvailable(): Promise<boolean> {
      control.probed.push(name);
      return control.available[name] ?? false;
    }
    async invoke(): Promise<string> {
      return "";
    }
  });

vi.mock("../../src/platforms/dsh.js", () => ({ DshAdapter: fakeAdapter("dsh") }));
vi.mock("../../src/platforms/claude-code.js", () => ({
  ClaudeCodeAdapter: fakeAdapter("claude-code"),
}));
vi.mock("../../src/platforms/gemini.js", () => ({ GeminiAdapter: fakeAdapter("gemini") }));
vi.mock("../../src/platforms/minimax.js", () => ({ MinimaxAdapter: fakeAdapter("minimax") }));

const { loadAdapters, detectPlatform } = await import("../../src/platforms/types.js");

beforeEach(() => {
  control.available = {};
  control.probed = [];
});

describe("loadAdapters", () => {
  it("loads every adapter in declaration order", async () => {
    const adapters = await loadAdapters();

    expect(adapters.map(a => a.name)).toEqual(["dsh", "claude-code", "gemini", "minimax"]);
  });

  it("returns adapter instances exposing name, label and invoke", async () => {
    const [dsh] = await loadAdapters();

    expect(dsh.label).toBe("dsh label");
    expect(typeof dsh.invoke).toBe("function");
    expect(typeof dsh.isAvailable).toBe("function");
  });

  it("returns a fresh set of instances on each call", async () => {
    const first = await loadAdapters();
    const second = await loadAdapters();

    expect(first[0]).not.toBe(second[0]);
  });
});

describe("detectPlatform", () => {
  it("returns null when no adapter reports availability", async () => {
    await expect(detectPlatform()).resolves.toBeNull();
    expect(control.probed).toEqual(["dsh", "claude-code", "gemini", "minimax"]);
  });

  it("returns the name of the only available adapter", async () => {
    control.available = { gemini: true };

    await expect(detectPlatform()).resolves.toBe("gemini");
  });

  it("prefers the earliest adapter when several are available", async () => {
    control.available = { dsh: true, gemini: true };

    await expect(detectPlatform()).resolves.toBe("dsh");
  });

  it("stops probing once an adapter reports available", async () => {
    control.available = { dsh: true };

    await detectPlatform();

    expect(control.probed).toEqual(["dsh"]);
  });
});
