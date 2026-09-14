import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", () => ({ execSync: vi.fn() }));

const { DshAdapter } = await import("../../src/platforms/dsh.js");

let tmp: string;
let fetchMock: ReturnType<typeof vi.fn>;

/** The prompt file the adapter wrote for this invocation. */
function writtenPromptFile(): string {
  const dir = join(tmp, ".qa-agent");
  const file = readdirSync(dir).find(f => f.startsWith("prompt-") && f.endsWith(".md"))!;
  return join(dir, file);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qa-agent-dsh-"));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("identity", () => {
  it("exposes the dsh name and label", () => {
    const adapter = new DshAdapter();

    expect(adapter.name).toBe("dsh");
    expect(adapter.label).toBe("DeepSeek Harness (DSH)");
  });
});

describe("isAvailable", () => {
  it("returns true when the health endpoint responds ok", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await expect(new DshAdapter().isAvailable()).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:3080/api/health");
  });

  it("returns false when the health endpoint is not ok", async () => {
    fetchMock.mockResolvedValue({ ok: false });

    await expect(new DshAdapter().isAvailable()).resolves.toBe(false);
  });

  it("returns false when the harness is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(new DshAdapter().isAvailable()).resolves.toBe(false);
  });

  it("bounds the health probe with an abort signal", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await new DshAdapter().isAvailable();

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("invoke via the REST API", () => {
  it("writes the prompt to a file under the work directory", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "done" });

    await new DshAdapter().invoke("PROMPT BODY", { workDir: tmp });

    expect(readFileSync(writtenPromptFile(), "utf-8")).toBe("PROMPT BODY");
  });

  it("returns the API response body when the call succeeds", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "agent output" });

    await expect(new DshAdapter().invoke("p", { workDir: tmp })).resolves.toBe("agent output");
  });

  it("posts a message pointing the agent at the prompt and result files", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "ok" });

    await new DshAdapter().invoke("p", { workDir: tmp });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3080/api/agent/message");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.message).toContain(writtenPromptFile());
    expect(body.message).toContain(".result.md");
    expect(body.timeout).toBe(300000);
  });

  it("forwards a custom timeout to the API", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "ok" });

    await new DshAdapter().invoke("p", { workDir: tmp, timeoutMs: 1234 });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).timeout).toBe(1234);
  });
});

describe("invoke via the result-file fallback", () => {
  /**
   * Write the result sidecar from inside the fetch mock. The adapter writes the
   * prompt file before it calls fetch, so by the time `outcome` runs the random
   * prompt filename exists and the first poll iteration finds the result.
   */
  function respondWithResult(content: string, outcome: "reject" | "non-ok") {
    fetchMock.mockImplementation(async () => {
      writeFileSync(`${writtenPromptFile()}.result.md`, content, "utf-8");
      if (outcome === "reject") throw new Error("ECONNREFUSED");
      return { ok: false, text: async () => "" };
    });
  }

  it("falls back to polling when the API rejects", async () => {
    respondWithResult("polled result", "reject");

    await expect(new DshAdapter().invoke("p", { workDir: tmp })).resolves.toBe("polled result");
  });

  it("falls back to polling when the API responds non-ok", async () => {
    respondWithResult("polled result", "non-ok");

    await expect(new DshAdapter().invoke("p", { workDir: tmp })).resolves.toBe("polled result");
  });

  it("ignores an empty result file and keeps waiting", async () => {
    respondWithResult("   ", "reject");

    await expect(new DshAdapter().invoke("p", { workDir: tmp, timeoutMs: 50 })).rejects.toThrow(
      /timed out/,
    );
  });

  it("prints the hand-off instructions for an in-session DSH agent", async () => {
    const logSpy = vi.spyOn(console, "log");
    respondWithResult("polled result", "reject");

    await new DshAdapter().invoke("p", { workDir: tmp });

    expect(logSpy.mock.calls.flat().join("\n")).toContain("[qa-agent] DSH adapter: prompt written to");
  });

  it("throws once the timeout elapses without a result file", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(new DshAdapter().invoke("p", { workDir: tmp, timeoutMs: 0 })).rejects.toThrow(
      /DSH adapter timed out waiting for result/,
    );
  });
});
