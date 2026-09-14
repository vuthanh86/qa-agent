import { describe, it, expect, vi, beforeEach } from "vitest";

const execSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: execSyncMock }));

const {
  getDiffFiles,
  getDiffContent,
  getLastCommitMessage,
  getCurrentBranch,
  classifyPath,
  parseDiffScope,
} = await import("../../src/utils/git.js");

beforeEach(() => {
  execSyncMock.mockReset();
});

describe("getDiffFiles", () => {
  it("returns the trimmed file list from a three-dot diff", () => {
    execSyncMock.mockReturnValue("src/a.ts\nsrc/b.ts\n");

    expect(getDiffFiles("main")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(execSyncMock).toHaveBeenCalledWith(
      "git diff --name-only main...HEAD",
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("honours an explicit head ref", () => {
    execSyncMock.mockReturnValue("src/a.ts\n");

    getDiffFiles("main", "feature");

    expect(execSyncMock).toHaveBeenCalledWith(
      "git diff --name-only main...feature",
      expect.anything(),
    );
  });

  it("drops blank lines rather than emitting empty paths", () => {
    execSyncMock.mockReturnValue("src/a.ts\n\n\nsrc/b.ts\n");

    expect(getDiffFiles("main")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns an empty array when the diff is empty", () => {
    execSyncMock.mockReturnValue("\n");

    expect(getDiffFiles("main")).toEqual([]);
  });

  it("falls back to a two-dot diff when the three-dot form fails", () => {
    execSyncMock
      .mockImplementationOnce(() => { throw new Error("no merge base"); })
      .mockReturnValueOnce("src/c.ts\n");

    expect(getDiffFiles("main")).toEqual(["src/c.ts"]);
    expect(execSyncMock).toHaveBeenNthCalledWith(
      2,
      "git diff --name-only main..HEAD",
      expect.anything(),
    );
  });

  it("returns an empty array when both diff forms fail", () => {
    execSyncMock.mockImplementation(() => { throw new Error("not a repo"); });

    expect(getDiffFiles("main")).toEqual([]);
  });
});

describe("getDiffContent", () => {
  it("returns the raw diff text", () => {
    execSyncMock.mockReturnValue("diff --git a/x b/x\n+added\n");

    expect(getDiffContent("main")).toBe("diff --git a/x b/x\n+added\n");
  });

  it("requests a 10MB buffer so large diffs are not truncated", () => {
    execSyncMock.mockReturnValue("");

    getDiffContent("main");

    expect(execSyncMock).toHaveBeenCalledWith(
      "git diff main...HEAD",
      expect.objectContaining({ maxBuffer: 10 * 1024 * 1024 }),
    );
  });

  it("returns an empty string when git fails", () => {
    execSyncMock.mockImplementation(() => { throw new Error("boom"); });

    expect(getDiffContent("main")).toBe("");
  });
});

describe("getLastCommitMessage", () => {
  it("trims the commit subject", () => {
    execSyncMock.mockReturnValue("  feat: add thing  \n");

    expect(getLastCommitMessage()).toBe("feat: add thing");
  });

  it("returns an empty string when there is no commit", () => {
    execSyncMock.mockImplementation(() => { throw new Error("no HEAD"); });

    expect(getLastCommitMessage()).toBe("");
  });
});

describe("getCurrentBranch", () => {
  it("trims the branch name", () => {
    execSyncMock.mockReturnValue("main\n");

    expect(getCurrentBranch()).toBe("main");
  });

  it("returns 'unknown' when git fails", () => {
    execSyncMock.mockImplementation(() => { throw new Error("detached"); });

    expect(getCurrentBranch()).toBe("unknown");
  });
});

describe("classifyPath", () => {
  it.each([
    ["src/obj/Debug/thing.cs", "Build"],
    ["app/bin/Release/out.dll", "Build"],
    ["src/generated/api.ts", "Build"],
    ["src/models.generated.cs", "Build"],
  ])("classifies %s as Build", (path, bucket) => {
    expect(classifyPath(path)).toBe(bucket);
  });

  it.each([
    ["PMI.Frontend.V2/app/main.js", "Frontend"],
    ["web/src/components/grid.tsx", "Frontend"],
    ["styles/theme.scss", "Frontend"],
    ["pages/index.html", "Frontend"],
    ["app/site.css", "Frontend"],
  ])("classifies %s as Frontend", (path, bucket) => {
    expect(classifyPath(path)).toBe(bucket);
  });

  it.each([
    ["db/migrations/001_init.sql", "Schema"],
    ["db/dump.psql", "Schema"],
    ["Schema/tables.txt", "Schema"],
  ])("classifies %s as Schema", (path, bucket) => {
    expect(classifyPath(path)).toBe(bucket);
  });

  it.each([
    ["PMIQueue.V3/Agents/Worker.txt", "Queue"],
    ["PMI.Microservice.V2/Queue/consumer.txt", "Queue"],
  ])("classifies %s as Queue", (path, bucket) => {
    expect(classifyPath(path)).toBe(bucket);
  });

  it.each([
    ["Solution.slnx", "Backend"],
    ["PMI.Microservice.V2/Program.txt", "Backend"],
    ["PMI.Service/Handler.txt", "Backend"],
    ["AutoMapping/profile.txt", "Backend"],
    ["BudgetForecast/calc.txt", "Backend"],
    ["Labor/rates.txt", "Backend"],
    ["Forecasting/model.txt", "Backend"],
    ["src/Domain/Order.cs", "Backend"],
    ["src/Api/Api.csproj", "Backend"],
  ])("classifies %s as Backend", (path, bucket) => {
    expect(classifyPath(path)).toBe(bucket);
  });

  it.each([
    ["docs/architecture.txt", "Docs"],
    ["README.md", "Docs"],
    ["azure-pipelines.yml", "Docs"],
    ["deploy/config.yaml", "Docs"],
    ["build/Dockerfile", "Docs"],
    ["pipeline-templates/steps.txt", "Docs"],
  ])("classifies %s as Docs", (path, bucket) => {
    expect(classifyPath(path)).toBe(bucket);
  });

  it("falls open to Unresolvable for unrecognised paths", () => {
    expect(classifyPath("LICENSE")).toBe("Unresolvable");
    expect(classifyPath("assets/logo.png")).toBe("Unresolvable");
  });

  it("prefers Build over Frontend for generated TypeScript", () => {
    expect(classifyPath("src/generated/client.ts")).toBe("Build");
  });

  it("does not classify node_modules TypeScript as Frontend", () => {
    expect(classifyPath("node_modules/pkg/index.d.ts")).not.toBe("Frontend");
  });
});

describe("parseDiffScope", () => {
  it("parses a three-dot diff scope", () => {
    expect(parseDiffScope("diff main...HEAD")).toEqual({ base: "main", head: "HEAD" });
  });

  it("parses a remote-qualified base", () => {
    expect(parseDiffScope("diff origin/main...HEAD")).toEqual({
      base: "origin/main",
      head: "HEAD",
    });
  });

  it("tolerates extra whitespace after the keyword", () => {
    expect(parseDiffScope("diff   main...HEAD")).toEqual({ base: "main", head: "HEAD" });
  });

  it.each([
    "story:12345",
    "diff main..HEAD",
    "main...HEAD",
    "",
    "diff main...HEAD extra",
  ])("returns null for non-diff scope %o", (scope) => {
    expect(parseDiffScope(scope)).toBeNull();
  });
});
