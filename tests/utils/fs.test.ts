import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const homedirMock = vi.hoisted(() => vi.fn());
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: homedirMock };
});

const {
  qaAgentHome,
  memoryDir,
  adoCacheDir,
  ensureDir,
  writeFile,
  fileExists,
  readFileSafe,
  generateOutDir,
  packageRoot,
  promptsDir,
  readPrompt,
} = await import("../../src/utils/fs.js");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qa-agent-fs-"));
  homedirMock.mockReturnValue(tmp);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("home directory resolution", () => {
  it("puts the qa-agent home under the user home directory", () => {
    expect(qaAgentHome()).toBe(join(tmp, ".qa-agent"));
  });

  it("nests the memory store inside the qa-agent home", () => {
    expect(memoryDir()).toBe(join(tmp, ".qa-agent", "memory"));
  });

  it("nests the ADO cache inside the qa-agent home", () => {
    expect(adoCacheDir()).toBe(join(tmp, ".qa-agent", "ado-cache"));
  });
});

describe("ensureDir", () => {
  it("creates a nested directory and returns its path", () => {
    const target = join(tmp, "a", "b", "c");

    expect(ensureDir(target)).toBe(target);
    expect(existsSync(target)).toBe(true);
  });

  it("is idempotent for an existing directory", () => {
    const target = join(tmp, "repeat");

    ensureDir(target);
    expect(() => ensureDir(target)).not.toThrow();
    expect(existsSync(target)).toBe(true);
  });
});

describe("writeFile", () => {
  it("creates missing parent directories before writing", () => {
    const target = join(tmp, "deep", "nested", "out.md");

    writeFile(target, "hello");

    expect(readFileSync(target, "utf-8")).toBe("hello");
  });

  it("overwrites existing content", () => {
    const target = join(tmp, "out.md");

    writeFile(target, "first");
    writeFile(target, "second");

    expect(readFileSync(target, "utf-8")).toBe("second");
  });

  it("round-trips non-ASCII content as UTF-8", () => {
    const target = join(tmp, "unicode.md");

    writeFile(target, "✅ pass — 日本語");

    expect(readFileSync(target, "utf-8")).toBe("✅ pass — 日本語");
  });
});

describe("fileExists", () => {
  it("returns true for an existing file", () => {
    const target = join(tmp, "present.txt");
    writeFileSync(target, "content");

    expect(fileExists(target)).toBe(true);
  });

  it("returns true for an empty file", () => {
    const target = join(tmp, "empty.txt");
    writeFileSync(target, "");

    expect(fileExists(target)).toBe(true);
  });

  it("returns false for a missing file", () => {
    expect(fileExists(join(tmp, "missing.txt"))).toBe(false);
  });

  it("returns false for a directory", () => {
    expect(fileExists(tmp)).toBe(false);
  });
});

describe("readFileSafe", () => {
  it("returns the file content when it exists", () => {
    const target = join(tmp, "present.txt");
    writeFileSync(target, "content");

    expect(readFileSafe(target)).toBe("content");
  });

  it("returns null for a missing file instead of throwing", () => {
    expect(readFileSafe(join(tmp, "missing.txt"))).toBeNull();
  });

  it("returns null when the path is a directory", () => {
    expect(readFileSafe(tmp)).toBeNull();
  });
});

describe("generateOutDir", () => {
  it("slugifies the scope and prefixes with plans/ by default", () => {
    const out = generateOutDir("diff main...HEAD");

    expect(out.startsWith(`plans${sep}`)).toBe(true);
    expect(out).toMatch(/-qa-diff-main-head$/);
  });

  it("honours a custom prefix", () => {
    expect(generateOutDir("scope", "runs").startsWith(`runs${sep}`)).toBe(true);
  });

  it("strips leading and trailing separators from the slug", () => {
    const out = generateOutDir("!!!feature!!!");

    expect(out).toMatch(/-qa-feature$/);
  });

  it("caps the slug at 40 characters", () => {
    const out = generateOutDir("a".repeat(100));
    const slug = out.split("-qa-")[1];

    expect(slug).toHaveLength(40);
  });

  it("embeds a UTC timestamp truncated to the minute", () => {
    const out = generateOutDir("scope");
    const name = out.split(sep).pop()!;

    // toISOString() with ":" and "." stripped, sliced to 15 chars => YYYY-MM-DDTHHMM
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{4}-qa-scope$/);
  });

  it("lowercases the slug", () => {
    expect(generateOutDir("MixedCase")).toMatch(/-qa-mixedcase$/);
  });
});

describe("packageRoot / promptsDir", () => {
  it("returns the directory of the module when not running from dist/", () => {
    // Under vitest the source runs from src/utils, so the dist/ branch is not taken.
    expect(packageRoot().endsWith("dist")).toBe(false);
    expect(packageRoot()).toContain("utils");
  });

  it("places prompts directly under the package root", () => {
    expect(promptsDir()).toBe(join(packageRoot(), "prompts"));
  });
});

describe("readPrompt", () => {
  it("returns null when the prompt file does not exist", () => {
    expect(readPrompt("definitely-not-a-prompt.md")).toBeNull();
  });
});
