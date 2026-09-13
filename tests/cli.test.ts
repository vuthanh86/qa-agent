import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  runCodegen: vi.fn(),
  runTranslate: vi.fn(),
  runReport: vi.fn(),
  runHistory: vi.fn(),
  parsePlanUrl: vi.fn(),
  getTestPlan: vi.fn(),
  getTestSuites: vi.fn(),
  getTestCases: vi.fn(),
  getWorkItem: vi.fn(),
  saveSnapshot: vi.fn(),
  restoreSnapshot: vi.fn(),
  listSnapshots: vi.fn(),
  isAgentBrowserAvailable: vi.fn(),
  loadAdapters: vi.fn(),
  detectPlatform: vi.fn(),
  writeFile: vi.fn(),
  readFileSafe: vi.fn(),
  ensureDir: vi.fn(),
  generateOutDir: vi.fn(),
  readPrompt: vi.fn(),
  getDiffFiles: vi.fn(),
  getDiffContent: vi.fn(),
  parseDiffScope: vi.fn(),
}));

vi.mock("../src/phases/codegen.js", () => ({ runCodegen: mocks.runCodegen }));
vi.mock("../src/phases/translate.js", () => ({ runTranslate: mocks.runTranslate }));
vi.mock("../src/phases/report.js", () => ({ runReport: mocks.runReport }));
vi.mock("../src/phases/history.js", () => ({ runHistory: mocks.runHistory }));
vi.mock("../src/ado/client.js", () => ({
  parsePlanUrl: mocks.parsePlanUrl,
  getTestPlan: mocks.getTestPlan,
  getTestSuites: mocks.getTestSuites,
  getTestCases: mocks.getTestCases,
  getWorkItem: mocks.getWorkItem,
}));
vi.mock("../src/snapshot/index.js", () => ({
  saveSnapshot: mocks.saveSnapshot,
  restoreSnapshot: mocks.restoreSnapshot,
  listSnapshots: mocks.listSnapshots,
  isAgentBrowserAvailable: mocks.isAgentBrowserAvailable,
}));
vi.mock("../src/platforms/types.js", () => ({
  loadAdapters: mocks.loadAdapters,
  detectPlatform: mocks.detectPlatform,
}));
vi.mock("../src/utils/fs.js", () => ({
  writeFile: mocks.writeFile,
  readFileSafe: mocks.readFileSafe,
  ensureDir: mocks.ensureDir,
  generateOutDir: mocks.generateOutDir,
  readPrompt: mocks.readPrompt,
}));
vi.mock("../src/utils/git.js", () => ({
  getDiffFiles: mocks.getDiffFiles,
  getDiffContent: mocks.getDiffContent,
  parseDiffScope: mocks.parseDiffScope,
}));

const cli = await import("../src/cli.js");

/** Thrown in place of a real process.exit so tests can assert on the code. */
class ProcessExit extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

/** An adapter double that records the prompts it was handed. */
function adapter(name: string, invoke = vi.fn(async () => "AI OUTPUT")) {
  return { name, label: name, invoke, isAvailable: vi.fn(async () => true) };
}

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExit(code ?? 0);
  }) as never);

  mocks.runCodegen.mockReturnValue({
    outDir: "out",
    planPath: "out/plan.md",
    pathCount: 2,
    diffContent: "",
  });
  mocks.runTranslate.mockReturnValue({ scenariosPath: "out/scenarios.md", caseCount: 3 });
  mocks.runReport.mockReturnValue({ reportPath: "out/results.md" });
  mocks.runHistory.mockReturnValue({ htmlPath: "out/history.html", mermaidPath: "out/history.mmd" });
  mocks.generateOutDir.mockReturnValue("plans/generated");
  mocks.readPrompt.mockReturnValue("PROMPT");
  mocks.readFileSafe.mockReturnValue("FILE");
  mocks.isAgentBrowserAvailable.mockReturnValue(false);
  mocks.loadAdapters.mockResolvedValue([adapter("dsh")]);
  mocks.detectPlatform.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("defaults the action to help when no argv is given", () => {
    expect(cli.parseArgs([])).toEqual({ action: "help" });
  });

  it("reads the action from the first positional argument", () => {
    expect(cli.parseArgs(["run"]).action).toBe("run");
  });

  it("parses --flag value pairs", () => {
    expect(cli.parseArgs(["run", "--scope", "diff main...HEAD"]).scope).toBe("diff main...HEAD");
  });

  it("treats a flag with no value as the string 'true'", () => {
    expect(cli.parseArgs(["snapshot", "--list"]).list).toBe("true");
  });

  it("treats a flag followed by another flag as a boolean", () => {
    const args = cli.parseArgs(["run", "--headed", "--depth", "core"]);

    expect(args.headed).toBe("true");
    expect(args.depth).toBe("core");
  });

  it("normalises dotted flags to camelCase", () => {
    const args = cli.parseArgs(["run", "--ado.org", "contoso", "--ado.project", "pmi"]);

    expect(args.adoOrg).toBe("contoso");
    expect(args.adoProject).toBe("pmi");
  });

  it("normalises kebab-case flags to camelCase", () => {
    const args = cli.parseArgs([
      "run",
      "--plan-url",
      "https://dev.azure.com/o/p/_testPlans/execute?planId=1",
      "--work-item",
      "33672",
    ]);

    expect(args.planUrl).toBe("https://dev.azure.com/o/p/_testPlans/execute?planId=1");
    expect(args.workItem).toBe("33672");
  });

  it("leaves already-camelCase flags untouched", () => {
    const args = cli.parseArgs(["run", "--outDir", "runs/x", "--timeboxMs", "1000"]);

    expect(args.outDir).toBe("runs/x");
    expect(args.timeboxMs).toBe("1000");
  });

  it("normalises a multi-dash flag across every segment", () => {
    expect(cli.parseArgs(["run", "--ado-plan-id", "123"]).adoPlanId).toBe("123");
  });

  it("parses single-dash flags as booleans", () => {
    expect(cli.parseArgs(["help", "-h"]).h).toBe("true");
  });

  it("ignores stray positional arguments after the action", () => {
    const args = cli.parseArgs(["run", "stray", "--depth", "full"]);

    expect(args.depth).toBe("full");
    expect(args.stray).toBeUndefined();
  });

  it("lets a later flag win when a flag is repeated", () => {
    expect(cli.parseArgs(["run", "--depth", "smoke", "--depth", "full"]).depth).toBe("full");
  });
});

describe("showHelp", () => {
  it("lists the available actions and flags", () => {
    const logSpy = vi.spyOn(console, "log");

    cli.showHelp();

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("qa-agent — Senior-QA AI Orchestrator");
    expect(out).toContain("codegen");
    expect(out).toContain("--plan-url");
  });
});

describe("resolvePlatform", () => {
  it("returns the adapter matching an explicit --platform", async () => {
    mocks.loadAdapters.mockResolvedValue([adapter("dsh"), adapter("gemini")]);

    const resolved = await cli.resolvePlatform({ action: "run", platform: "gemini" });

    expect(resolved.name).toBe("gemini");
  });

  it("matches --platform case-insensitively", async () => {
    mocks.loadAdapters.mockResolvedValue([adapter("claude-code")]);

    const resolved = await cli.resolvePlatform({ action: "run", platform: "Claude-Code" });

    expect(resolved.name).toBe("claude-code");
  });

  it("exits when the requested platform is unknown", async () => {
    mocks.loadAdapters.mockResolvedValue([adapter("dsh")]);

    await expect(
      cli.resolvePlatform({ action: "run", platform: "nope" }),
    ).rejects.toThrow(ProcessExit);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("uses the auto-detected platform when no flag is given", async () => {
    mocks.loadAdapters.mockResolvedValue([adapter("dsh"), adapter("gemini")]);
    mocks.detectPlatform.mockResolvedValue("gemini");

    const resolved = await cli.resolvePlatform({ action: "run" });

    expect(resolved.name).toBe("gemini");
  });

  it("falls back to the only adapter when detection fails", async () => {
    mocks.loadAdapters.mockResolvedValue([adapter("dsh")]);
    mocks.detectPlatform.mockResolvedValue(null);

    const resolved = await cli.resolvePlatform({ action: "run" });

    expect(resolved.name).toBe("dsh");
  });

  it("exits when detection fails and several adapters are installed", async () => {
    mocks.loadAdapters.mockResolvedValue([adapter("dsh"), adapter("gemini")]);
    mocks.detectPlatform.mockResolvedValue(null);

    await expect(cli.resolvePlatform({ action: "run" })).rejects.toThrow(ProcessExit);
  });

  it("exits when no adapters are installed at all", async () => {
    mocks.loadAdapters.mockResolvedValue([]);
    mocks.detectPlatform.mockResolvedValue(null);

    await expect(cli.resolvePlatform({ action: "run" })).rejects.toThrow(ProcessExit);
  });
});

describe("actionCodegen", () => {
  it("applies the documented defaults", async () => {
    await cli.actionCodegen({ action: "codegen" });

    expect(mocks.runCodegen).toHaveBeenCalledWith({
      scope: "diff origin/main...HEAD",
      base: "origin/main",
      depth: "smoke",
      outDir: undefined,
    });
  });

  it("passes explicit flags through", async () => {
    await cli.actionCodegen({
      action: "codegen",
      scope: "story:1",
      base: "develop",
      depth: "full",
      outDir: "runs/x",
    });

    expect(mocks.runCodegen).toHaveBeenCalledWith({
      scope: "story:1",
      base: "develop",
      depth: "full",
      outDir: "runs/x",
    });
  });
});

describe("actionTranslate", () => {
  it("derives plan.md from --outDir when no --scope is given", async () => {
    await cli.actionTranslate({ action: "translate", outDir: "runs/x" });

    expect(mocks.runTranslate).toHaveBeenCalledWith({
      in: join("runs/x", "plan.md"),
      outDir: "runs/x",
      target: undefined,
    });
  });

  it("treats --scope as an explicit input path", async () => {
    await cli.actionTranslate({ action: "translate", scope: "custom/plan.md" });

    expect(mocks.runTranslate).toHaveBeenCalledWith({
      in: "custom/plan.md",
      outDir: "plans",
      target: undefined,
    });
  });

  it("falls back to plans/plan.md when neither flag is given", async () => {
    await cli.actionTranslate({ action: "translate" });

    expect(mocks.runTranslate).toHaveBeenCalledWith({
      in: "plans/plan.md",
      outDir: "plans",
      target: undefined,
    });
  });

  it("forwards the target URL", async () => {
    await cli.actionTranslate({ action: "translate", target: "https://qa.example.com" });

    expect(mocks.runTranslate.mock.calls[0][0].target).toBe("https://qa.example.com");
  });
});

describe("actionReport", () => {
  it("defaults the run directory to the current directory", async () => {
    await cli.actionReport({ action: "report" });

    expect(mocks.runReport).toHaveBeenCalledWith({ runDir: ".", skipHistory: false });
  });

  it("skips history only when --history is exactly 'false'", async () => {
    await cli.actionReport({ action: "report", outDir: "runs/x", history: "false" });
    expect(mocks.runReport).toHaveBeenCalledWith({ runDir: "runs/x", skipHistory: true });

    await cli.actionReport({ action: "report", history: "true" });
    expect(mocks.runReport).toHaveBeenLastCalledWith({ runDir: ".", skipHistory: false });
  });
});

describe("actionHistory", () => {
  it("defaults the output directory and run limit", async () => {
    await cli.actionHistory({ action: "history" });

    expect(mocks.runHistory).toHaveBeenCalledWith({
      outDir: ".",
      feature: undefined,
      env: undefined,
      last: 50,
    });
  });

  it("parses --last as an integer", async () => {
    await cli.actionHistory({ action: "history", last: "30", feature: "Checkout", env: "qa" });

    expect(mocks.runHistory).toHaveBeenCalledWith({
      outDir: ".",
      feature: "Checkout",
      env: "qa",
      last: 30,
    });
  });
});

describe("actionSnapshot", () => {
  it("saves under the given name", async () => {
    await cli.actionSnapshot({ action: "snapshot", save: "login", feature: "Checkout", env: "qa" });

    expect(mocks.saveSnapshot).toHaveBeenCalledWith("login", "Checkout", "qa");
  });

  it("uses the name 'snapshot' for a bare --save flag", async () => {
    await cli.actionSnapshot({ action: "snapshot", save: "true" });

    expect(mocks.saveSnapshot).toHaveBeenCalledWith("snapshot", "default", "qa");
  });

  it("restores under the given name", async () => {
    await cli.actionSnapshot({ action: "snapshot", restore: "login" });

    expect(mocks.restoreSnapshot).toHaveBeenCalledWith("login", "default", "qa");
  });

  it("uses the name 'snapshot' for a bare --restore flag", async () => {
    await cli.actionSnapshot({ action: "snapshot", restore: "true" });

    expect(mocks.restoreSnapshot).toHaveBeenCalledWith("snapshot", "default", "qa");
  });

  it("reports when a listing is empty", async () => {
    mocks.listSnapshots.mockReturnValue([]);
    const logSpy = vi.spyOn(console, "log");

    await cli.actionSnapshot({ action: "snapshot", list: "true", feature: "Checkout" });

    expect(logSpy.mock.calls.flat().join("\n")).toContain("No snapshots for Checkout/qa");
  });

  it("prints each snapshot's name, url and timestamp", async () => {
    mocks.listSnapshots.mockReturnValue([
      { name: "login", url: "https://qa/x", timestamp: "2026-01-01T00:00:00.000Z" },
    ]);
    const logSpy = vi.spyOn(console, "log");

    await cli.actionSnapshot({ action: "snapshot", list: "true" });

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("login — https://qa/x (2026-01-01T00:00:00.000Z)");
  });

  it("exits when no snapshot sub-action is given", async () => {
    await expect(cli.actionSnapshot({ action: "snapshot" })).rejects.toThrow(ProcessExit);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("actionRun — Mode A", () => {
  it("runs codegen, translate and report in order", async () => {
    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

    expect(mocks.runCodegen).toHaveBeenCalled();
    expect(mocks.runTranslate).toHaveBeenCalled();
    expect(mocks.runReport).toHaveBeenCalled();
  });

  it("generates an output directory when none is given", async () => {
    await cli.actionRun({ action: "run", platform: "dsh" });

    expect(mocks.generateOutDir).toHaveBeenCalledWith("diff origin/main...HEAD");
  });

  it("hands the codegen prompt and plan skeleton to the adapter", async () => {
    const invoke = vi.fn(async () => "AI OUTPUT");
    mocks.loadAdapters.mockResolvedValue([adapter("dsh", invoke)]);
    mocks.readPrompt.mockReturnValue("CODEGEN PROMPT");
    mocks.readFileSafe.mockReturnValue("PLAN SKELETON");

    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

    expect(invoke.mock.calls[0][0]).toContain("CODEGEN PROMPT");
    expect(invoke.mock.calls[0][0]).toContain("PLAN SKELETON");
  });

  it("writes the AI response alongside the plan", async () => {
    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

    expect(mocks.writeFile).toHaveBeenCalledWith(
      join("runs/x", "plan-ai-response.md"),
      "AI OUTPUT",
    );
  });

  it("continues with the skeleton plan when the AI invocation fails", async () => {
    const invoke = vi.fn(async () => { throw new Error("adapter down"); });
    mocks.loadAdapters.mockResolvedValue([adapter("dsh", invoke)]);

    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

    expect(mocks.runTranslate).toHaveBeenCalled();
  });

  it("honours --timeboxMs for the codegen invocation", async () => {
    const invoke = vi.fn(async () => "AI OUTPUT");
    mocks.loadAdapters.mockResolvedValue([adapter("dsh", invoke)]);

    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x", timeboxMs: "1000" });

    expect(invoke.mock.calls[0][1].timeoutMs).toBe(1000);
  });

  it("writes the draft test plan", async () => {
    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

    const draft = mocks.writeFile.mock.calls.find(c => c[0] === join("runs/x", "ado-draft.md"));
    expect(draft).toBeDefined();
  });

  it("verifies against a work item when --work-item is supplied", async () => {
    const invoke = vi.fn(async () => "AI OUTPUT");
    mocks.loadAdapters.mockResolvedValue([adapter("dsh", invoke)]);

    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x", workItem: "33672" });

    expect(invoke.mock.calls[1][0]).toContain("33672");
    expect(mocks.writeFile).toHaveBeenCalledWith(join("runs/x", "verify-report.md"), "AI OUTPUT");
  });

  it("skips verification when the AI is unavailable", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce("AI OUTPUT")
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue("AI OUTPUT");
    mocks.loadAdapters.mockResolvedValue([adapter("dsh", invoke)]);

    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x", workItem: "33672" });

    expect(mocks.writeFile).not.toHaveBeenCalledWith(
      join("runs/x", "verify-report.md"),
      expect.anything(),
    );
  });

  it("skips e2e and reports manual scenarios when agent-browser is absent", async () => {
    mocks.isAgentBrowserAvailable.mockReturnValue(false);

    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

    expect(mocks.writeFile).not.toHaveBeenCalledWith(
      join("runs/x", "results.json"),
      expect.anything(),
    );
  });

  it("scaffolds results.json and drives e2e when agent-browser is present", async () => {
    mocks.isAgentBrowserAvailable.mockReturnValue(true);

    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x", depth: "core" });

    const scaffoldCall = mocks.writeFile.mock.calls.find(
      c => c[0] === join("runs/x", "results.json"),
    );
    const scaffold = JSON.parse(scaffoldCall![1]);
    expect(scaffold.depth).toBe("core");
    expect(scaffold.summary.total).toBe(3);
    expect(scaffold.summary.skipped).toBe(3);
  });

  it("allows a 10-minute timeout for the e2e invocation", async () => {
    mocks.isAgentBrowserAvailable.mockReturnValue(true);
    const invoke = vi.fn(async () => "AI OUTPUT");
    mocks.loadAdapters.mockResolvedValue([adapter("dsh", invoke)]);

    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

    const e2eCall = invoke.mock.calls.find(c => c[0].includes("Scenarios to execute"));
    expect(e2eCall![1].timeoutMs).toBe(600000);
  });

  it("continues to the report when e2e execution fails", async () => {
    mocks.isAgentBrowserAvailable.mockReturnValue(true);
    const invoke = vi
      .fn()
      .mockResolvedValueOnce("AI OUTPUT")
      .mockRejectedValueOnce(new Error("e2e blew up"));
    mocks.loadAdapters.mockResolvedValue([adapter("dsh", invoke)]);

    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

    expect(mocks.runReport).toHaveBeenCalled();
  });

  it("tolerates a missing results.json at report time", async () => {
    mocks.runReport.mockImplementation(() => { throw new Error("results.json not found"); });
    const logSpy = vi.spyOn(console, "log");

    await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

    expect(logSpy.mock.calls.flat().join("\n")).toContain("No results.json yet");
  });
});

describe("actionRun — Mode B", () => {
  const planUrl = "https://dev.azure.com/contoso/pmi/_testPlans/execute?planId=123";

  beforeEach(() => {
    mocks.parsePlanUrl.mockReturnValue({ org: "contoso", project: "pmi", planId: 123 });
    mocks.getTestPlan.mockResolvedValue({ id: 123, name: "Regression", state: "Active" });
    mocks.getTestSuites.mockResolvedValue([{ id: 1, name: "Root" }]);
    mocks.getTestCases.mockResolvedValue([{ id: 42, title: "Login" }]);
    mocks.getWorkItem.mockResolvedValue({
      id: 7,
      title: "Story",
      description: "desc",
      acceptanceCriteria: "AC",
    });
  });

  it("exits when the plan URL cannot be parsed", async () => {
    mocks.parsePlanUrl.mockReturnValue(null);

    await expect(
      cli.actionRun({ action: "run", platform: "dsh", planUrl: "garbage" }),
    ).rejects.toThrow(ProcessExit);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("pulls the plan, its suites and their cases", async () => {
    await cli.actionRun({ action: "run", platform: "dsh", planUrl, outDir: "runs/x" });

    expect(mocks.getTestPlan).toHaveBeenCalledWith(
      { org: "contoso", project: "pmi", pat: undefined },
      123,
    );
    expect(mocks.getTestSuites).toHaveBeenCalled();
    expect(mocks.getTestCases).toHaveBeenCalledWith(expect.anything(), 123, 1);
  });

  it("forwards --ado.pat to the ADO client", async () => {
    await cli.actionRun({
      action: "run",
      platform: "dsh",
      planUrl,
      outDir: "runs/x",
      adoPat: "secret",
    });

    expect(mocks.getTestPlan).toHaveBeenCalledWith(
      { org: "contoso", project: "pmi", pat: "secret" },
      123,
    );
  });

  it("writes the raw ADO pull to ado-plan.json", async () => {
    await cli.actionRun({ action: "run", platform: "dsh", planUrl, outDir: "runs/x" });

    const call = mocks.writeFile.mock.calls.find(c => c[0] === join("runs/x", "ado-plan.json"));
    const payload = JSON.parse(call![1]);
    expect(payload.plan.name).toBe("Regression");
    expect(payload.cases).toHaveLength(1);
  });

  it("exits when the ADO fetch fails", async () => {
    mocks.getTestPlan.mockRejectedValue(new Error("401 Unauthorized"));

    await expect(
      cli.actionRun({ action: "run", platform: "dsh", planUrl, outDir: "runs/x" }),
    ).rejects.toThrow(ProcessExit);
  });

  it("includes the story text in the audit prompt when --work-item is given", async () => {
    const invoke = vi.fn(async () => "AI OUTPUT");
    mocks.loadAdapters.mockResolvedValue([adapter("dsh", invoke)]);

    await cli.actionRun({
      action: "run",
      platform: "dsh",
      planUrl,
      outDir: "runs/x",
      workItem: "7",
    });

    expect(mocks.getWorkItem).toHaveBeenCalledWith(expect.anything(), 7);
    expect(invoke.mock.calls[0][0]).toContain("## User Story: Story");
  });

  it("continues the audit when the work item cannot be fetched", async () => {
    mocks.getWorkItem.mockRejectedValue(new Error("404"));

    await cli.actionRun({
      action: "run",
      platform: "dsh",
      planUrl,
      outDir: "runs/x",
      workItem: "7",
    });

    expect(mocks.writeFile).toHaveBeenCalledWith(join("runs/x", "ado-audit.md"), "AI OUTPUT");
  });

  it("writes the audit and the finalized cases", async () => {
    await cli.actionRun({ action: "run", platform: "dsh", planUrl, outDir: "runs/x" });

    expect(mocks.writeFile).toHaveBeenCalledWith(join("runs/x", "ado-audit.md"), "AI OUTPUT");
    expect(mocks.writeFile).toHaveBeenCalledWith(join("runs/x", "finalized-cases.md"), "AI OUTPUT");
  });

  it("keeps going when the audit invocation fails", async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error("audit failed"))
      .mockResolvedValue("AI OUTPUT");
    mocks.loadAdapters.mockResolvedValue([adapter("dsh", invoke)]);

    await cli.actionRun({ action: "run", platform: "dsh", planUrl, outDir: "runs/x" });

    expect(mocks.writeFile).toHaveBeenCalledWith(join("runs/x", "finalized-cases.md"), "AI OUTPUT");
  });

  it("keeps going when the improve invocation fails", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce("AI OUTPUT")
      .mockRejectedValueOnce(new Error("improve failed"));
    mocks.loadAdapters.mockResolvedValue([adapter("dsh", invoke)]);

    await cli.actionRun({ action: "run", platform: "dsh", planUrl, outDir: "runs/x" });

    expect(mocks.writeFile).toHaveBeenCalledWith(join("runs/x", "plan.md"), expect.anything());
  });

  it("generates an output directory keyed on the plan id", async () => {
    await cli.actionRun({ action: "run", platform: "dsh", planUrl });

    expect(mocks.generateOutDir).toHaveBeenCalledWith("ado-plan-123");
  });

  it("notes agent-browser availability for the optional e2e step", async () => {
    mocks.isAgentBrowserAvailable.mockReturnValue(true);
    const logSpy = vi.spyOn(console, "log");

    await cli.actionRun({ action: "run", platform: "dsh", planUrl, outDir: "runs/x" });

    expect(logSpy.mock.calls.flat().join("\n")).toContain("agent-browser available");
  });
});

describe("actionRun — mode routing on --plan-url", () => {
  const planUrl = "https://dev.azure.com/contoso/pmi/_testPlans/execute?planId=123";

  beforeEach(() => {
    mocks.parsePlanUrl.mockReturnValue({ org: "contoso", project: "pmi", planId: 123 });
    mocks.getTestPlan.mockResolvedValue({ id: 123, name: "Regression", state: "Active" });
    mocks.getTestSuites.mockResolvedValue([{ id: 1, name: "Root" }]);
    mocks.getTestCases.mockResolvedValue([{ id: 42, title: "Login" }]);
  });

  describe("without a plan URL — Mode A (generate from scratch)", () => {
    it("runs the generate pipeline", async () => {
      await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

      expect(mocks.runCodegen).toHaveBeenCalled();
      expect(mocks.runTranslate).toHaveBeenCalled();
      expect(mocks.runReport).toHaveBeenCalled();
    });

    it("never touches Azure DevOps", async () => {
      await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

      expect(mocks.parsePlanUrl).not.toHaveBeenCalled();
      expect(mocks.getTestPlan).not.toHaveBeenCalled();
      expect(mocks.getTestSuites).not.toHaveBeenCalled();
      expect(mocks.getTestCases).not.toHaveBeenCalled();
    });

    it("announces Mode A", async () => {
      const logSpy = vi.spyOn(console, "log");

      await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x" });

      expect(logSpy.mock.calls.flat().join("\n")).toContain("Mode A — Generate from scratch");
    });

    it("treats an empty plan URL as absent and stays in Mode A", async () => {
      await cli.actionRun({ action: "run", platform: "dsh", outDir: "runs/x", planUrl: "" });

      expect(mocks.runCodegen).toHaveBeenCalled();
      expect(mocks.parsePlanUrl).not.toHaveBeenCalled();
    });
  });

  describe("with a plan URL — Mode B (audit existing plan)", () => {
    it("runs the audit pipeline against the given URL", async () => {
      await cli.actionRun({ action: "run", platform: "dsh", planUrl, outDir: "runs/x" });

      expect(mocks.parsePlanUrl).toHaveBeenCalledWith(planUrl);
      expect(mocks.getTestPlan).toHaveBeenCalled();
      expect(mocks.getTestSuites).toHaveBeenCalled();
    });

    it("never runs the generate phases", async () => {
      await cli.actionRun({ action: "run", platform: "dsh", planUrl, outDir: "runs/x" });

      expect(mocks.runCodegen).not.toHaveBeenCalled();
      expect(mocks.runTranslate).not.toHaveBeenCalled();
      expect(mocks.runReport).not.toHaveBeenCalled();
    });

    it("announces Mode B", async () => {
      const logSpy = vi.spyOn(console, "log");

      await cli.actionRun({ action: "run", platform: "dsh", planUrl, outDir: "runs/x" });

      expect(logSpy.mock.calls.flat().join("\n")).toContain("Mode B — Audit existing test plan");
    });

    it("routes on presence of the flag, not on the URL being valid", async () => {
      mocks.parsePlanUrl.mockReturnValue(null);

      await expect(
        cli.actionRun({ action: "run", platform: "dsh", planUrl: "garbage" }),
      ).rejects.toThrow(ProcessExit);

      // Mode B was entered and rejected the URL; it did not silently fall back to Mode A.
      expect(mocks.parsePlanUrl).toHaveBeenCalledWith("garbage");
      expect(mocks.runCodegen).not.toHaveBeenCalled();
    });
  });

  describe("dispatched through the documented CLI flag", () => {
    const originalArgv = process.argv;

    afterEach(() => {
      process.argv = originalArgv;
    });

    /** Run main() with the given CLI arguments. */
    function runMain(...args: string[]) {
      process.argv = ["node", "cli.js", ...args];
      return cli.main();
    }

    it("selects Mode A for 'run' with no --plan-url", async () => {
      await runMain("run", "--platform", "dsh", "--outDir", "runs/x");

      expect(mocks.runCodegen).toHaveBeenCalled();
      expect(mocks.getTestPlan).not.toHaveBeenCalled();
    });

    it("selects Mode B for 'run --plan-url <url>'", async () => {
      await runMain("run", "--platform", "dsh", "--plan-url", planUrl, "--outDir", "runs/x");

      expect(mocks.parsePlanUrl).toHaveBeenCalledWith(planUrl);
      expect(mocks.getTestPlan).toHaveBeenCalled();
      expect(mocks.runCodegen).not.toHaveBeenCalled();
    });

    it("accepts the camelCase --planUrl spelling too", async () => {
      await runMain("run", "--platform", "dsh", "--planUrl", planUrl, "--outDir", "runs/x");

      expect(mocks.parsePlanUrl).toHaveBeenCalledWith(planUrl);
      expect(mocks.runCodegen).not.toHaveBeenCalled();
    });

    it("exits when --plan-url is passed with no value", async () => {
      mocks.parsePlanUrl.mockReturnValue(null);

      await expect(runMain("run", "--platform", "dsh", "--plan-url")).rejects.toThrow(ProcessExit);

      expect(mocks.parsePlanUrl).toHaveBeenCalledWith("true");
    });
  });
});

describe("main", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  /** Run main() with the given CLI arguments. */
  function runMain(...args: string[]) {
    process.argv = ["node", "cli.js", ...args];
    return cli.main();
  }

  it.each(["help", "-h", "--help"])("shows help for %s", async (flag) => {
    const logSpy = vi.spyOn(console, "log");

    await runMain(flag);

    expect(logSpy.mock.calls.flat().join("\n")).toContain("USAGE:");
  });

  it("defaults to help when no action is given", async () => {
    const logSpy = vi.spyOn(console, "log");

    await runMain();

    expect(logSpy.mock.calls.flat().join("\n")).toContain("USAGE:");
  });

  it("dispatches codegen", async () => {
    await runMain("codegen", "--scope", "diff main...HEAD");

    expect(mocks.runCodegen).toHaveBeenCalled();
  });

  it("dispatches translate", async () => {
    await runMain("translate", "--outDir", "runs/x");

    expect(mocks.runTranslate).toHaveBeenCalled();
  });

  it("dispatches report", async () => {
    await runMain("report", "--outDir", "runs/x");

    expect(mocks.runReport).toHaveBeenCalled();
  });

  it("dispatches history", async () => {
    await runMain("history", "--feature", "Checkout");

    expect(mocks.runHistory).toHaveBeenCalled();
  });

  it("dispatches snapshot", async () => {
    mocks.listSnapshots.mockReturnValue([]);

    await runMain("snapshot", "--list");

    expect(mocks.listSnapshots).toHaveBeenCalled();
  });

  it("dispatches run", async () => {
    await runMain("run", "--platform", "dsh", "--outDir", "runs/x");

    expect(mocks.runCodegen).toHaveBeenCalled();
  });

  it("exits with an error for an unknown action", async () => {
    const errSpy = vi.spyOn(console, "error");

    await expect(runMain("frobnicate")).rejects.toThrow(ProcessExit);

    expect(errSpy.mock.calls.flat().join("\n")).toContain("Unknown action: frobnicate");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
