import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const execSyncMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: execSyncMock, spawn: spawnMock }));

const { ClaudeCodeAdapter } = await import("../../src/platforms/claude-code.js");
const { GeminiAdapter } = await import("../../src/platforms/gemini.js");
const { MinimaxAdapter } = await import("../../src/platforms/minimax.js");
import type { PlatformAdapter } from "../../src/platforms/types.js";

/** A spawn() stand-in whose stdio can be driven from the test. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = new PassThrough();

  /** Everything the adapter wrote to stdin. */
  async stdinText(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString();
  }
}

let tmp: string;
let child: FakeChild;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qa-agent-adapter-"));
  execSyncMock.mockReset();
  spawnMock.mockReset();
  child = new FakeChild();
  spawnMock.mockReturnValue(child);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Resolve on the next macrotask so the adapter can attach its listeners first. */
function onNextTick(fn: () => void) {
  setTimeout(fn, 0);
}

const cases: Array<{
  label: string;
  make: () => PlatformAdapter;
  name: string;
  bin: string;
  versionCmd: string;
  promptPrefix: string;
  expectedArgs: (promptFile: string) => string[];
}> = [
  {
    label: "ClaudeCodeAdapter",
    make: () => new ClaudeCodeAdapter(),
    name: "claude-code",
    bin: "claude",
    versionCmd: "claude --version",
    promptPrefix: "claude-prompt-",
    // The prompt travels on stdin, so no prompt argument appears in argv.
    expectedArgs: () => ["--print"],
  },
  {
    label: "GeminiAdapter",
    make: () => new GeminiAdapter(),
    name: "gemini",
    bin: "gemini",
    versionCmd: "gemini --version",
    promptPrefix: "gemini-prompt-",
    expectedArgs: (f) => ["chat", "--prompt-file", f],
  },
  {
    label: "MinimaxAdapter",
    make: () => new MinimaxAdapter(),
    name: "minimax",
    bin: "minimax-code",
    versionCmd: "minimax-code --version",
    promptPrefix: "minimax-prompt-",
    expectedArgs: (f) => ["run", "--file", f],
  },
];

describe.each(cases)("$label", (spec) => {
  it("exposes a stable name and human-readable label", () => {
    const adapter = spec.make();

    expect(adapter.name).toBe(spec.name);
    expect(adapter.label).toBeTruthy();
  });

  describe("isAvailable", () => {
    it("returns true when the version probe succeeds", async () => {
      execSyncMock.mockReturnValue("");

      await expect(spec.make().isAvailable()).resolves.toBe(true);
      expect(execSyncMock).toHaveBeenCalledWith(spec.versionCmd, { stdio: "ignore" });
    });

    it("returns false when the binary is missing", async () => {
      execSyncMock.mockImplementation(() => { throw new Error("ENOENT"); });

      await expect(spec.make().isAvailable()).resolves.toBe(false);
    });
  });

  describe("invoke", () => {
    it("writes the prompt to a .qa-agent file inside the work directory", async () => {
      const promise = spec.make().invoke("PROMPT BODY", { workDir: tmp });
      onNextTick(() => child.emit("close", 0));
      await promise;

      const files = readdirSync(join(tmp, ".qa-agent"));
      const promptFile = files.find(f => f.startsWith(spec.promptPrefix));
      expect(promptFile).toBeDefined();
      expect(readFileSync(join(tmp, ".qa-agent", promptFile!), "utf-8")).toBe("PROMPT BODY");
    });

    it("resolves with the accumulated stdout on a zero exit code", async () => {
      const promise = spec.make().invoke("p", { workDir: tmp });
      onNextTick(() => {
        child.stdout.emit("data", Buffer.from("part one "));
        child.stdout.emit("data", Buffer.from("part two"));
        child.emit("close", 0);
      });

      await expect(promise).resolves.toBe("part one part two");
    });

    it("rejects with the exit code and stderr on a non-zero exit", async () => {
      const promise = spec.make().invoke("p", { workDir: tmp });
      onNextTick(() => {
        child.stderr.emit("data", Buffer.from("bad flag"));
        child.emit("close", 2);
      });

      await expect(promise).rejects.toThrow(`${spec.bin} exited with code 2: bad flag`);
    });

    it("rejects when the process fails to spawn", async () => {
      const promise = spec.make().invoke("p", { workDir: tmp });
      onNextTick(() => child.emit("error", new Error("spawn ENOENT")));

      await expect(promise).rejects.toThrow("spawn ENOENT");
    });

    it("invokes the expected binary and base arguments", async () => {
      const promise = spec.make().invoke("p", { workDir: tmp });
      onNextTick(() => child.emit("close", 0));
      await promise;

      const [bin, args] = spawnMock.mock.calls[0];
      const promptFile = join(
        tmp,
        ".qa-agent",
        readdirSync(join(tmp, ".qa-agent")).find(f => f.startsWith(spec.promptPrefix))!,
      );
      expect(bin).toBe(spec.bin);
      expect(args.slice(0, spec.expectedArgs(promptFile).length)).toEqual(
        spec.expectedArgs(promptFile),
      );
    });

    it("appends a --model flag when a model is requested", async () => {
      const promise = spec.make().invoke("p", { workDir: tmp, model: "some-model" });
      onNextTick(() => child.emit("close", 0));
      await promise;

      const args = spawnMock.mock.calls[0][1] as string[];
      expect(args).toContain("--model");
      expect(args[args.indexOf("--model") + 1]).toBe("some-model");
    });

    it("omits the --model flag when no model is requested", async () => {
      const promise = spec.make().invoke("p", { workDir: tmp });
      onNextTick(() => child.emit("close", 0));
      await promise;

      expect(spawnMock.mock.calls[0][1]).not.toContain("--model");
    });

    it("appends caller-supplied extra flags last", async () => {
      const promise = spec.make().invoke("p", { workDir: tmp, extra: ["--verbose"] });
      onNextTick(() => child.emit("close", 0));
      await promise;

      const args = spawnMock.mock.calls[0][1] as string[];
      expect(args[args.length - 1]).toBe("--verbose");
    });

    it("runs in the work directory and merges extra env over process.env", async () => {
      const promise = spec.make().invoke("p", { workDir: tmp, env: { QA_TOKEN: "xyz" } });
      onNextTick(() => child.emit("close", 0));
      await promise;

      const opts = spawnMock.mock.calls[0][2];
      expect(opts.cwd).toBe(tmp);
      expect(opts.env.QA_TOKEN).toBe("xyz");
      expect(opts.env.PATH ?? opts.env.Path).toBeDefined();
    });

    it("defaults to a 5-minute timeout and honours an override", async () => {
      const first = spec.make().invoke("p", { workDir: tmp });
      onNextTick(() => child.emit("close", 0));
      await first;
      expect(spawnMock.mock.calls[0][2].timeout).toBe(300000);

      child = new FakeChild();
      spawnMock.mockReturnValue(child);
      const second = spec.make().invoke("p", { workDir: tmp, timeoutMs: 1000 });
      onNextTick(() => child.emit("close", 0));
      await second;
      expect(spawnMock.mock.calls[1][2].timeout).toBe(1000);
    });

    it("defaults the work directory to process.cwd()", async () => {
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmp);

      const promise = spec.make().invoke("p");
      onNextTick(() => child.emit("close", 0));
      await promise;

      expect(spawnMock.mock.calls[0][2].cwd).toBe(tmp);
      cwdSpy.mockRestore();
    });
  });
});

describe("ClaudeCodeAdapter prompt delivery", () => {
  it("sends the prompt on stdin", async () => {
    const promise = new ClaudeCodeAdapter().invoke("THE FULL PROMPT", { workDir: tmp });
    const written = child.stdinText();
    onNextTick(() => child.emit("close", 0));
    await promise;

    expect(await written).toBe("THE FULL PROMPT");
  });

  it("opens stdin as a pipe so the prompt can be written", async () => {
    const promise = new ClaudeCodeAdapter().invoke("p", { workDir: tmp });
    onNextTick(() => child.emit("close", 0));
    await promise;

    expect(spawnMock.mock.calls[0][2].stdio).toEqual(["pipe", "pipe", "pipe"]);
  });

  it("never passes the prompt as a command-line argument", async () => {
    const promise = new ClaudeCodeAdapter().invoke("THE FULL PROMPT", { workDir: tmp });
    onNextTick(() => child.emit("close", 0));
    await promise;

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).not.toContain("THE FULL PROMPT");
  });

  it("never relies on shell command substitution to read the prompt file", async () => {
    // spawn() performs no shell expansion, so a "$(cat ...)" argument would
    // reach the CLI as a literal string and the prompt would be lost.
    const promise = new ClaudeCodeAdapter().invoke("p", { workDir: tmp });
    onNextTick(() => child.emit("close", 0));
    await promise;

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args.some(a => a.includes("$("))).toBe(false);
  });

  it("passes --print exactly once", async () => {
    const promise = new ClaudeCodeAdapter().invoke("p", { workDir: tmp });
    onNextTick(() => child.emit("close", 0));
    await promise;

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args.filter(a => a === "--print" || a === "-p")).toEqual(["--print"]);
  });

  it("omits --max-tokens, which the claude CLI does not accept", async () => {
    const promise = new ClaudeCodeAdapter().invoke("p", { workDir: tmp, maxTokens: 4096 });
    onNextTick(() => child.emit("close", 0));
    await promise;

    expect(spawnMock.mock.calls[0][1]).not.toContain("--max-tokens");
  });

  it("rejects when the child closes stdin before the prompt is written", async () => {
    const promise = new ClaudeCodeAdapter().invoke("p", { workDir: tmp });
    onNextTick(() => child.stdin.emit("error", new Error("EPIPE")));

    await expect(promise).rejects.toThrow("EPIPE");
  });

  it("reports a placeholder when a failing child produced no stderr", async () => {
    const promise = new ClaudeCodeAdapter().invoke("p", { workDir: tmp });
    onNextTick(() => child.emit("close", 1));

    await expect(promise).rejects.toThrow("claude exited with code 1: no stderr output");
  });

  it("names the timeout when the child is killed by a signal", async () => {
    const promise = new ClaudeCodeAdapter().invoke("p", { workDir: tmp, timeoutMs: 1000 });
    // A spawn timeout surfaces as a null exit code plus a signal.
    onNextTick(() => child.emit("close", null, "SIGTERM"));

    await expect(promise).rejects.toThrow(
      "claude was terminated by SIGTERM after 1000ms; raise the timeout with --timeboxMs if the task needs longer",
    );
  });

  it("does not misreport a signal kill as an exit code", async () => {
    const promise = new ClaudeCodeAdapter().invoke("p", { workDir: tmp });
    onNextTick(() => child.emit("close", null, "SIGKILL"));

    await expect(promise).rejects.not.toThrow(/exited with code null/);
  });
});
