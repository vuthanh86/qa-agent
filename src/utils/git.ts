/**
 * Git helpers — diff enumeration, base resolution, commit info.
 */

import { execSync } from "node:child_process";

export interface DiffFile {
  path: string;
  bucket: Bucket;
}

export type Bucket = "Frontend" | "Backend" | "Schema" | "Queue" | "Docs" | "Build" | "Unresolvable";

/**
 * Get the list of changed files between base and HEAD.
 */
export function getDiffFiles(base: string, head: string = "HEAD"): string[] {
  try {
    const output = execSync(`git diff --name-only ${base}...${head}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    // Try two-dot diff as fallback
    try {
      const output = execSync(`git diff --name-only ${base}..${head}`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return output.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
}

/**
 * Get the full diff content between base and HEAD.
 */
export function getDiffContent(base: string, head: string = "HEAD"): string {
  try {
    return execSync(`git diff ${base}...${head}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
  } catch {
    return "";
  }
}

/**
 * Get the last commit message.
 */
export function getLastCommitMessage(): string {
  try {
    return execSync(`git log -1 --pretty=format:"%s"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Get the current branch name.
 */
export function getCurrentBranch(): string {
  try {
    return execSync("git branch --show-current", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Classify a changed file path into a bucket.
 * PMI-aware but works in any repo.
 */
export function classifyPath(path: string): Bucket {
  // Build / generated
  if (/\/obj\//.test(path) || /\/bin\//.test(path) ||
      /\/generated\//.test(path) || /\.generated\./.test(path)) {
    return "Build";
  }

  // Frontend
  if (/PMI\.Frontend\.V2/.test(path) ||
      /\/src\/.*\.(ts|tsx|html|scss|css)$/.test(path) ||
      /\.(ts|tsx|html|scss|css)$/.test(path) && !/node_modules/.test(path)) {
    return "Frontend";
  }

  // Schema / SQL
  if (/\.sql$/.test(path) || /\.psql$/.test(path) || /Schema[\\/]/.test(path)) {
    return "Schema";
  }

  // Queue agents
  if (/PMIQueue\.V3[\\/]Agents/.test(path) ||
      /PMI\.Microservice\.V2[\\/]Queue/.test(path)) {
    return "Queue";
  }

  // Backend domains
  if (/\.slnx$/.test(path) ||
      /PMI\.Microservice\.V2/.test(path) ||
      /PMI\.Service/.test(path) ||
      /AutoMapping/.test(path) ||
      /BudgetForecast/.test(path) ||
      /Labor/.test(path) ||
      /Forecasting/.test(path) ||
      /\.cs$/.test(path) ||
      /\.csproj$/.test(path)) {
    return "Backend";
  }

  // Docs / config / CI
  if (/docs[\\/]/.test(path) ||
      /\.md$/.test(path) ||
      /\.ya?ml$/.test(path) ||
      /Dockerfile/.test(path) ||
      /pipeline-templates/.test(path)) {
    return "Docs";
  }

  // Can't classify — fail open
  return "Unresolvable";
}

/**
 * Try to resolve a diff scope string to a base ref.
 * "diff main...HEAD" → base="main", head="HEAD"
 * "diff origin/main...HEAD" → base="origin/main", head="HEAD"
 */
export function parseDiffScope(scope: string): { base: string; head: string } | null {
  const m = scope.match(/^diff\s+(\S+)\.\.\.(\S+)$/);
  if (!m) return null;
  return { base: m[1], head: m[2] };
}
