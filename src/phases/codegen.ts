/**
 * Phase 1 — Codegen: git diff → risk-ranked test case skeleton.
 *
 * This is the MECHANICAL part only:
 * - Resolves the diff scope
 * - Classifies changed paths into buckets
 * - Writes a skeleton plan.md with impact map + case table (TBD fields)
 *
 * The AI reasoning (reading the diff, authoring real cases, filling TBDs)
 * is done by the platform adapter reading prompts/codegen.md.
 */

import { getDiffFiles, getDiffContent, classifyPath, getLastCommitMessage, parseDiffScope, Bucket } from "../utils/git.js";
import { writeFile, generateOutDir } from "../utils/fs.js";

export interface CodegenOptions {
  scope: string;
  base: string;
  depth: "smoke" | "core" | "full";
  outDir?: string;
}

export interface CodegenResult {
  outDir: string;
  planPath: string;
  pathCount: number;
  diffContent: string;
}

export function runCodegen(options: CodegenOptions): CodegenResult {
  const { scope, base, depth } = options;
  const outDir = options.outDir ?? generateOutDir(scope);
  const planPath = `${outDir}/plan.md`;

  // Resolve diff
  const parsed = parseDiffScope(scope);
  const paths = parsed
    ? getDiffFiles(parsed.base, parsed.head)
    : getDiffFiles(base, "HEAD");

  const diffContent = parsed
    ? getDiffContent(parsed.base, parsed.head)
    : getDiffContent(base, "HEAD");

  const commitMsg = getLastCommitMessage();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";

  // Classify paths
  const classified = paths.map(p => ({ path: p, bucket: classifyPath(p) }));

  // Build plan.md
  const lines: string[] = [];
  lines.push(`# QA plan — ${scope}`);
  lines.push("");
  lines.push(`**Generated:** ${now}  **Depth:** ${depth}  **Base:** ${base}`);
  if (commitMsg) lines.push(`**Commit:** ${commitMsg}`);
  lines.push("");

  // Impact map
  lines.push("## Impact map (diff → surface → case)");
  lines.push("");
  lines.push("| Changed path | Bucket | Module / surface | Case ids |");
  lines.push("|---|---|---|---|");

  if (classified.length === 0) {
    lines.push(`| (no path list) | n/a | story: ${scope} | TBD |`);
  } else {
    let caseIdx = 0;
    for (const c of classified) {
      caseIdx++;
      const id = `AUTO-${String(caseIdx).padStart(2, "0")}`;
      lines.push(`| ${c.path} | ${c.bucket} | TBD | ${id} |`);
    }
  }
  lines.push("");

  // Pruned cases section (placeholder)
  lines.push("## Pruned cases (recorded, not dropped)");
  lines.push("");
  lines.push("| Case id | Reason for prune |");
  lines.push("|---|---|");
  lines.push("| (none) | |");
  lines.push("");

  // Case table
  lines.push("## Case table");
  lines.push("");
  lines.push("| id | title | priority | surface | preconditions | test data | expected | trace |");
  lines.push("|---|---|---|---|---|---|---|---|");

  if (classified.length > 0) {
    let i = 0;
    for (const c of classified) {
      i++;
      const id = `AUTO-${String(i).padStart(2, "0")}`;
      const title = `Smoke check on ${c.path.split("/").pop() ?? c.path}`;
      lines.push(`| ${id} | ${title} | P0 | TBD | TBD | TBD | TBD | ${scope} |`);
    }
  } else {
    lines.push(`| AUTO-01 | (no paths) — author a case from the story text | P0 | TBD | TBD | TBD | TBD | ${scope} |`);
  }
  lines.push("");

  // Exit criteria
  lines.push("## Exit criteria");
  lines.push("");
  if (depth === "smoke") lines.push("- all P0 PASS, no S1");
  else if (depth === "core") lines.push("- P0-P1 PASS, no S1/S2");
  else lines.push("- no open S1/S2; justified P2/P3 exceptions");
  lines.push("");

  // AI instruction block
  lines.push("---");
  lines.push("");
  lines.push("## AI Task: Fill in the TBDs");
  lines.push("");
  lines.push("The case table above has `TBD` fields. Read the git diff below,");
  lines.push("then for each case fill in:");
  lines.push("- **surface**: the screen/endpoint/query affected");
  lines.push("- **preconditions**: state the app must be in");
  lines.push("- **test data**: tenant/account/entity/date range");
  lines.push("- **expected**: explicit, falsifiable, observable expected result");
  lines.push("- **priority**: adjust from P0 default if needed (P0/P1/P2/P3)");
  lines.push("");
  lines.push("Add new cases for gaps you find. Prune cases outside the blast");
  lines.push("radius (record the prune reason, don't silently drop).");
  lines.push("");
  lines.push("### Git diff");
  lines.push("");
  lines.push("```diff");
  lines.push(diffContent.slice(0, 50000)); // cap at 50KB
  lines.push("```");

  // Write
  writeFile(planPath, lines.join("\n"));

  // Write impact map sidecar
  writeFile(`${outDir}/impact-map.md`, classified.map(c => `${c.path} → ${c.bucket}`).join("\n"));

  return {
    outDir,
    planPath,
    pathCount: classified.length,
    diffContent,
  };
}
