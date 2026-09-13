import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const git = vi.hoisted(() => ({
  getDiffFiles: vi.fn(),
  getDiffContent: vi.fn(),
  getLastCommitMessage: vi.fn(),
  parseDiffScope: vi.fn(),
  classifyPath: vi.fn(),
}));

vi.mock("../../src/utils/git.js", () => git);

const { runCodegen } = await import("../../src/phases/codegen.js");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qa-agent-codegen-"));
  git.getDiffFiles.mockReturnValue([]);
  git.getDiffContent.mockReturnValue("");
  git.getLastCommitMessage.mockReturnValue("");
  git.parseDiffScope.mockReturnValue(null);
  git.classifyPath.mockImplementation((p: string) => (p.endsWith(".cs") ? "Backend" : "Frontend"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Run codegen into the temp dir and return the generated plan.md text. */
function run(overrides: Partial<Parameters<typeof runCodegen>[0]> = {}) {
  const result = runCodegen({
    scope: "diff main...HEAD",
    base: "main",
    depth: "smoke",
    outDir: tmp,
    ...overrides,
  });
  return { result, plan: readFileSync(result.planPath, "utf-8") };
}

describe("diff resolution", () => {
  it("uses the parsed scope refs when the scope is a diff spec", () => {
    git.parseDiffScope.mockReturnValue({ base: "origin/main", head: "feature" });

    run({ scope: "diff origin/main...feature" });

    expect(git.getDiffFiles).toHaveBeenCalledWith("origin/main", "feature");
    expect(git.getDiffContent).toHaveBeenCalledWith("origin/main", "feature");
  });

  it("falls back to the base option against HEAD for a non-diff scope", () => {
    git.parseDiffScope.mockReturnValue(null);

    run({ scope: "story:123", base: "develop" });

    expect(git.getDiffFiles).toHaveBeenCalledWith("develop", "HEAD");
    expect(git.getDiffContent).toHaveBeenCalledWith("develop", "HEAD");
  });
});

describe("output location", () => {
  it("writes plan.md and impact-map.md into the given outDir", () => {
    const { result } = run();

    expect(result.planPath).toBe(`${tmp}/plan.md`);
    expect(existsSync(result.planPath)).toBe(true);
    expect(existsSync(join(tmp, "impact-map.md"))).toBe(true);
  });

  it("generates a timestamped outDir when none is supplied", () => {
    const result = runCodegen({
      scope: "diff main...HEAD",
      base: "main",
      depth: "smoke",
      outDir: join(tmp, "generated"),
    });

    expect(result.outDir).toBe(join(tmp, "generated"));
  });
});

describe("plan header", () => {
  it("records the scope, depth and base", () => {
    const { plan } = run({ depth: "core", base: "develop" });

    expect(plan).toContain("# QA plan — diff main...HEAD");
    expect(plan).toContain("**Depth:** core");
    expect(plan).toContain("**Base:** develop");
  });

  it("includes the last commit message when there is one", () => {
    git.getLastCommitMessage.mockReturnValue("feat: add checkout");

    expect(run().plan).toContain("**Commit:** feat: add checkout");
  });

  it("omits the commit line when there is no commit message", () => {
    git.getLastCommitMessage.mockReturnValue("");

    expect(run().plan).not.toContain("**Commit:**");
  });
});

describe("impact map and case table", () => {
  it("emits one impact row per changed path with its bucket", () => {
    git.getDiffFiles.mockReturnValue(["src/app.ts", "src/Domain/Order.cs"]);

    const { plan, result } = run();

    expect(result.pathCount).toBe(2);
    expect(plan).toContain("| src/app.ts | Frontend | TBD | AUTO-01 |");
    expect(plan).toContain("| src/Domain/Order.cs | Backend | TBD | AUTO-02 |");
  });

  it("zero-pads case ids to two digits", () => {
    git.getDiffFiles.mockReturnValue(Array.from({ length: 11 }, (_, i) => `src/f${i}.ts`));

    const { plan } = run();

    expect(plan).toContain("AUTO-01");
    expect(plan).toContain("AUTO-11");
  });

  it("derives the case title from the file basename", () => {
    git.getDiffFiles.mockReturnValue(["src/features/checkout/cart.ts"]);

    expect(run().plan).toContain("| AUTO-01 | Smoke check on cart.ts | P0 |");
  });

  it("emits a placeholder row when the diff is empty", () => {
    git.getDiffFiles.mockReturnValue([]);

    const { plan, result } = run();

    expect(result.pathCount).toBe(0);
    expect(plan).toContain("| (no path list) | n/a | story: diff main...HEAD | TBD |");
    expect(plan).toContain("| AUTO-01 | (no paths) — author a case from the story text |");
  });

  it("writes the path→bucket mapping to the impact-map sidecar", () => {
    git.getDiffFiles.mockReturnValue(["src/app.ts", "src/Domain/Order.cs"]);

    run();

    expect(readFileSync(join(tmp, "impact-map.md"), "utf-8")).toBe(
      "src/app.ts → Frontend\nsrc/Domain/Order.cs → Backend",
    );
  });
});

describe("exit criteria by depth", () => {
  it.each([
    ["smoke", "- all P0 PASS, no S1"],
    ["core", "- P0-P1 PASS, no S1/S2"],
    ["full", "- no open S1/S2; justified P2/P3 exceptions"],
  ] as const)("emits the %s exit criteria", (depth, expected) => {
    expect(run({ depth }).plan).toContain(expected);
  });
});

describe("embedded diff", () => {
  it("embeds the diff in a fenced diff block", () => {
    git.getDiffContent.mockReturnValue("diff --git a/x b/x\n+added");

    const { plan, result } = run();

    expect(plan).toContain("```diff\ndiff --git a/x b/x\n+added\n```");
    expect(result.diffContent).toBe("diff --git a/x b/x\n+added");
  });

  it("caps the embedded diff at 50KB while returning the full diff", () => {
    const huge = "x".repeat(60000);
    git.getDiffContent.mockReturnValue(huge);

    const { plan, result } = run();

    expect(result.diffContent).toHaveLength(60000);
    expect(plan).toContain("x".repeat(50000));
    expect(plan).not.toContain("x".repeat(50001));
  });
});
