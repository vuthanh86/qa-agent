#!/usr/bin/env node
/**
 * qa-agent — Senior-QA AI Orchestrator CLI
 *
 * Single entry point. Two modes:
 *   Mode A (no --plan-url): codegen → draft → verify → translate → e2e → report
 *   Mode B (--plan-url):     read → audit → improve → finalize → e2e → report
 *
 * Usage:
 *   qa-agent run --scope "diff main...HEAD" --platform dsh
 *   qa-agent run --plan-url "https://dev.azure.com/..." --platform claude-code
 *   qa-agent codegen --scope "diff main...HEAD"
 *   qa-agent history --feature X --env qa
 */

import { runCodegen } from "./phases/codegen.js";
import { runTranslate } from "./phases/translate.js";
import { runReport } from "./phases/report.js";
import { runHistory } from "./phases/history.js";
import { parsePlanUrl } from "./ado/client.js";
import { saveSnapshot, restoreSnapshot, listSnapshots, isAgentBrowserAvailable } from "./snapshot/index.js";
import { loadAdapters, PlatformAdapter, detectPlatform } from "./platforms/types.js";
import { writeFile, readFileSafe, ensureDir, generateOutDir, readPrompt } from "./utils/fs.js";
import { getDiffFiles, getDiffContent, parseDiffScope } from "./utils/git.js";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CliArgs {
  action: string;
  scope?: string;
  base?: string;
  depth?: string;
  planUrl?: string;
  workItem?: string;
  target?: string;
  outDir?: string;
  feature?: string;
  env?: string;
  checkpoint?: string;
  snapshot?: string;
  platform?: string;
  history?: string;
  headed?: string;
  timeboxMs?: string;
  adoOrg?: string;
  adoProject?: string;
  adoPlanId?: string;
  adoPat?: string;
  adoPublish?: string;
  [key: string]: string | undefined;
}

// ─── Arg Parser ──────────────────────────────────────────────────────────────

export function parseArgs(raw: string[]): CliArgs {
  const args: CliArgs = { action: raw[0] ?? "help" };
  let i = 1;

  while (i < raw.length) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      let val: string | undefined = "true";
      if (i + 1 < raw.length && !raw[i + 1].startsWith("--")) {
        val = raw[i + 1];
        i++;
      }
      // Normalize dots to camelCase for nested flags
      const normalized = key.replace(/\.([a-z])/g, (_, c) => c.toUpperCase());
      args[normalized] = val;
    } else if (a.startsWith("-")) {
      args[a.slice(1)] = "true";
    }
    i++;
  }

  return args;
}

// ─── Help ────────────────────────────────────────────────────────────────────

export function showHelp(): void {
  console.log(`
qa-agent — Senior-QA AI Orchestrator

USAGE:
  qa-agent <action> [--flag value ...]

ACTIONS:
  run         Full pipeline (codegen → draft → verify → translate → e2e → report)
  codegen     Phase 1 — git diff → risk-ranked test cases
  translate   Phase 3 — plan.md → ## Scenario blocks
  report      Phase 5 — results.json → report + defects
  history     Render QA history graph (HTML + Mermaid)
  snapshot    Snapshot save|restore|list|diff helpers
  help        This help

COMMON FLAGS:
  --scope "<diff spec>"    diff main...HEAD | story:<id> | feature name
  --base <ref>             Base ref for git diff (default: origin/main)
  --depth smoke|core|full  smoke (P0) | core (P0-P1) | full (P0-P3)
  --plan-url <url>         ADO test plan URL (triggers Mode B: audit existing)
  --work-item <id>         User story work item id for verification
  --target <url>           Web app base URL (default: env QA_BASE_URL)
  --platform dsh|claude-code|gemini|minimax  AI platform to invoke
  --feature <name>         Feature name for memory key
  --env <name>             Env name (qa | staging | prod)
  --outDir <dir>           Run directory (default: plans/<ts>-qa-<slug>)
  --checkpoint <name>      Named snapshot to restore before e2e
  --snapshot <a,b,c>       Named snapshots to take after each case
  --history true|false     Render history graph (default: true)
  --ado.org|--ado.project|--ado.planId  ADO target
  --headed true|false      Headed (default true) vs headless
  --timeboxMs <ms>         Per-case timeout (default: 300000)

EXAMPLES:
  qa-agent run --scope "diff main...HEAD" --depth smoke --platform dsh
  qa-agent run --plan-url "https://dev.azure.com/org/proj/_testPlans/execute?planId=123"
  qa-agent codegen --scope "diff main...HEAD"
  qa-agent history --feature PortfolioPerspective --env qa --last 30
`);
}

// ─── Platform Helpers ────────────────────────────────────────────────────────

export async function resolvePlatform(args: CliArgs): Promise<PlatformAdapter> {
  const adapters = await loadAdapters();
  const platformName = args.platform?.toLowerCase();

  if (platformName) {
    const adapter = adapters.find(a => a.name === platformName);
    if (adapter) return adapter;
    console.error(`[qa-agent] Unknown platform: ${platformName}`);
    console.error(`[qa-agent] Available: ${adapters.map(a => a.name).join(", ") || "none detected"}`);
    process.exit(1);
  }

  // Auto-detect
  const detected = await detectPlatform();
  if (detected) {
    console.log(`[qa-agent] Auto-detected platform: ${detected}`);
    const adapter = adapters.find(a => a.name === detected);
    if (adapter) return adapter;
  }

  if (adapters.length === 1) return adapters[0];

  console.error("[qa-agent] No --platform specified and could not auto-detect.");
  console.error("[qa-agent] Available platforms: " + (adapters.map(a => a.name).join(", ") || "none detected"));
  console.error("[qa-agent] Specify one with: --platform dsh|claude-code|gemini|minimax");
  process.exit(1);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function actionCodegen(args: CliArgs): Promise<void> {
  const scope = args.scope ?? "diff origin/main...HEAD";
  const base = args.base ?? "origin/main";
  const depth = (args.depth as "smoke" | "core" | "full") ?? "smoke";

  const result = runCodegen({ scope, base, depth, outDir: args.outDir });
  console.log(`[qa-agent] codegen → ${result.planPath} (${result.pathCount} paths)`);
}

export async function actionTranslate(args: CliArgs): Promise<void> {
  const input = args.scope ?? (args.outDir ? join(args.outDir, "plan.md") : "plans/plan.md");
  const outDir = args.outDir ?? "plans";

  const result = runTranslate({ in: input, outDir, target: args.target });
  console.log(`[qa-agent] translate → ${result.scenariosPath} (${result.caseCount} scenario(s))`);
}

export async function actionReport(args: CliArgs): Promise<void> {
  const runDir = args.outDir ?? ".";
  const result = runReport({ runDir, skipHistory: args.history === "false" });
  console.log(`[qa-agent] report → ${result.reportPath}`);
}

export async function actionHistory(args: CliArgs): Promise<void> {
  const outDir = args.outDir ?? ".";
  const result = runHistory({
    outDir,
    feature: args.feature,
    env: args.env,
    last: args.last ? parseInt(args.last, 10) : 50,
  });
  console.log(`[qa-agent] history → ${result.htmlPath}`);
}

export async function actionSnapshot(args: CliArgs): Promise<void> {
  const feature = args.feature ?? "default";
  const env = args.env ?? "qa";

  if (args.save) {
    saveSnapshot(args.save === "true" ? "snapshot" : args.save, feature, env);
  } else if (args.restore) {
    restoreSnapshot(args.restore === "true" ? "snapshot" : args.restore, feature, env);
  } else if (args.list) {
    const snaps = listSnapshots(feature, env);
    if (snaps.length === 0) {
      console.log(`[qa-agent] No snapshots for ${feature}/${env}`);
    } else {
      console.log(`Snapshots for ${feature}/${env}:`);
      for (const s of snaps) {
        console.log(`  ${s.name} — ${s.url} (${s.timestamp})`);
      }
    }
  } else {
    console.error("[qa-agent] snapshot: need --save <name>, --restore <name>, or --list");
    process.exit(1);
  }
}

// ─── Run Pipeline ────────────────────────────────────────────────────────────

export async function actionRun(args: CliArgs): Promise<void> {
  const planUrl = args.planUrl;

  if (planUrl) {
    await runModeB(args, planUrl);
  } else {
    await runModeA(args);
  }
}

/**
 * Mode A — Generate from scratch.
 * codegen → draft → verify → translate → e2e → report
 */
async function runModeA(args: CliArgs): Promise<void> {
  const scope = args.scope ?? "diff origin/main...HEAD";
  const base = args.base ?? "origin/main";
  const depth = (args.depth as "smoke" | "core" | "full") ?? "smoke";
  const platform = await resolvePlatform(args);
  const outDir = args.outDir ?? generateOutDir(scope);

  console.log(`\n[qa-agent] Mode A — Generate from scratch`);
  console.log(`[qa-agent] Scope: ${scope}  Depth: ${depth}  Platform: ${platform.name}`);
  console.log(`[qa-agent] Output: ${outDir}\n`);

  // Phase 1 — codegen (mechanical)
  console.log("=== Phase 1: codegen ===");
  const codegenResult = runCodegen({ scope, base, depth, outDir });
  console.log(`  → ${codegenResult.planPath} (${codegenResult.pathCount} paths)`);

  // Phase 1b — AI authors real cases
  const codegenPrompt = readPrompt("codegen.md") ?? "";
  const fullCodegenPrompt = `${codegenPrompt}\n\n---\n\n## Plan skeleton\n\n${readFileSafe(codegenResult.planPath) ?? ""}`;
  console.log("  → Invoking AI to author test cases...");
  try {
    const aiResult = await platform.invoke(fullCodegenPrompt, {
      workDir: process.cwd(),
      timeoutMs: args.timeboxMs ? parseInt(args.timeboxMs, 10) : 300000,
    });
    writeFile(join(outDir, "plan-ai-response.md"), aiResult);
    console.log("  → AI response written to plan-ai-response.md");
  } catch (err: any) {
    console.error(`  → AI invocation failed: ${err.message}`);
    console.log("  → Continuing with skeleton plan — fill TBDs manually.");
  }

  // Phase 2 — draft test plan
  console.log("\n=== Phase 2: draft ===");
  writeFile(join(outDir, "ado-draft.md"), `# Draft Test Plan — ${scope}\n\n> Generated from code change. Review and refine before publishing.\n\nSee plan.md for case table.`);
  console.log(`  → ${join(outDir, "ado-draft.md")}`);

  // Phase 3 — verify against story
  console.log("\n=== Phase 3: verify ===");
  if (args.workItem) {
    console.log(`  → Verifying against work item: ${args.workItem}`);
    const verifyPrompt = `Review the test plan at ${join(outDir, "plan.md")} against work item ${args.workItem}. Check: accuracy, preconditions, required params, end-user readiness. Report gaps.`;
    try {
      const aiResult = await platform.invoke(verifyPrompt, { workDir: process.cwd() });
      writeFile(join(outDir, "verify-report.md"), aiResult);
    } catch {
      console.log("  → Verification skipped (AI unavailable)");
    }
  } else {
    console.log("  → No --work-item provided. Run: qa-agent verify --work-item <id>");
  }

  // Phase 4 — translate (mechanical)
  console.log("\n=== Phase 4: translate ===");
  const translateResult = runTranslate({ in: join(outDir, "plan.md"), outDir, target: args.target });
  console.log(`  → ${translateResult.scenariosPath} (${translateResult.caseCount} scenarios)`);

  // Phase 5 — e2e
  console.log("\n=== Phase 5: e2e ===");
  if (isAgentBrowserAvailable()) {
    // Write results scaffold
    const resultsScaffold = {
      runId: outDir.split("/").pop() ?? outDir.split("\\").pop(),
      scope,
      env: args.target ?? process.env.QA_BASE_URL ?? null,
      depth,
      date: new Date().toISOString(),
      summary: { total: translateResult.caseCount, passed: 0, failed: 0, skipped: translateResult.caseCount, durationMs: 0 },
      cases: [] as any[],
      defects: [],
      qaAgent: { runId: "", feature: args.feature ?? "default", env: args.env ?? "qa", checkpoint: null, snapshots: [] },
    };
    writeFile(join(outDir, "results.json"), JSON.stringify(resultsScaffold, null, 2));

    // AI drives agent-browser
    const e2ePrompt = readPrompt("e2e.md") ?? "";
    const scenarios = readFileSafe(join(outDir, "scenarios.md")) ?? "";
    const fullE2ePrompt = `${e2ePrompt}\n\n## Scenarios to execute\n\n${scenarios}\n\nWrite results to ${join(outDir, "results.json")}`;
    console.log("  → Invoking AI to drive agent-browser...");
    try {
      const aiResult = await platform.invoke(fullE2ePrompt, {
        workDir: process.cwd(),
        timeoutMs: 600000, // 10 min for e2e
      });
      writeFile(join(outDir, "e2e-ai-response.md"), aiResult);
    } catch (err: any) {
      console.error(`  → E2E execution failed: ${err.message}`);
    }
  } else {
    console.log("  → agent-browser not found. Install it for e2e execution.");
    console.log("  → Scenarios ready for manual execution: " + join(outDir, "scenarios.md"));
  }

  // Phase 6 — report (mechanical)
  console.log("\n=== Phase 6: report ===");
  try {
    const reportResult = runReport({ runDir: outDir, skipHistory: args.history === "false" });
    console.log(`  → ${reportResult.reportPath}`);
  } catch {
    console.log("  → No results.json yet — report skipped. Run e2e first.");
  }

  console.log(`\n[qa-agent] DONE — artifacts under ${outDir}`);
}

/**
 * Mode B — Audit existing ADO test plan.
 * read → audit → improve → finalize → e2e → report
 */
async function runModeB(args: CliArgs, planUrl: string): Promise<void> {
  const platform = await resolvePlatform(args);
  const parsed = parsePlanUrl(planUrl);

  if (!parsed) {
    console.error(`[qa-agent] Could not parse plan URL: ${planUrl}`);
    console.error("[qa-agent] Expected format: https://dev.azure.com/{org}/{project}/_testPlans/execute?planId={id}");
    process.exit(1);
  }

  const { org, project, planId } = parsed;
  const outDir = args.outDir ?? generateOutDir(`ado-plan-${planId}`);

  console.log(`\n[qa-agent] Mode B — Audit existing test plan`);
  console.log(`[qa-agent] Org: ${org}  Project: ${project}  Plan: ${planId}`);
  console.log(`[qa-agent] Platform: ${platform.name}  Output: ${outDir}\n`);

  // Phase 1 — read (mechanical: fetch from ADO)
  console.log("=== Phase 1: read ===");
  const { getTestPlan, getTestSuites, getTestCases, getWorkItem } = await import("./ado/client.js");
  try {
    const plan = await getTestPlan({ org, project, pat: args.adoPat }, planId);
    console.log(`  Plan: ${plan.name} (${plan.state})`);

    const suites = await getTestSuites({ org, project, pat: args.adoPat }, planId);
    console.log(`  Suites: ${suites.length}`);

    let allCases: any[] = [];
    for (const suite of suites) {
      const cases = await getTestCases({ org, project, pat: args.adoPat }, planId, suite.id);
      allCases = allCases.concat(cases);
    }
    console.log(`  Test cases: ${allCases.length}`);

    // Write raw pull
    writeFile(join(outDir, "ado-plan.json"), JSON.stringify({ plan, suites, cases: allCases }, null, 2));
  } catch (err: any) {
    console.error(`  → ADO fetch failed: ${err.message}`);
    console.error("  → Check ADO_PAT and network access.");
    process.exit(1);
  }

  // Phase 2 — audit (AI)
  console.log("\n=== Phase 2: audit ===");
  const workItemId = args.workItem;
  let storyText = "";
  if (workItemId) {
    try {
      const story = await getWorkItem({ org, project, pat: args.adoPat }, parseInt(workItemId, 10));
      storyText = `## User Story: ${story.title}\n\n${story.description}\n\n### Acceptance Criteria\n${story.acceptanceCriteria}`;
      console.log(`  → Story: ${story.title}`);
    } catch {
      console.log(`  → Could not fetch work item ${workItemId}`);
    }
  } else {
    console.log("  → No --work-item provided. AI will ask if needed.");
  }

  const auditPrompt = readPrompt("ado-audit.md") ?? "";
  const planData = readFileSafe(join(outDir, "ado-plan.json")) ?? "";
  const fullAuditPrompt = `${auditPrompt}\n\n${storyText}\n\n## Test Plan Data\n\n\`\`\`json\n${planData.slice(0, 100000)}\n\`\`\`\n\nAudit each test case for: accuracy, end-user readiness (preconditions, required params), steps quality, expected results. Produce a keep/update/split/merge/drop verdict per case. Write to ${join(outDir, "ado-audit.md")}.`;

  console.log("  → Invoking AI to audit test cases...");
  try {
    const aiResult = await platform.invoke(fullAuditPrompt, { workDir: process.cwd(), timeoutMs: 300000 });
    writeFile(join(outDir, "ado-audit.md"), aiResult);
    console.log(`  → ${join(outDir, "ado-audit.md")}`);
  } catch (err: any) {
    console.error(`  → Audit failed: ${err.message}`);
  }

  // Phase 3 — improve (AI)
  console.log("\n=== Phase 3: improve ===");
  const improvePrompt = `Read the audit at ${join(outDir, "ado-audit.md")}. For each case with verdict "update", "split", or "merge", draft the improved version with: explicit preconditions, all required params, executable steps, explicit expected results. Write finalized cases to ${join(outDir, "finalized-cases.md")}.`;
  try {
    const aiResult = await platform.invoke(improvePrompt, { workDir: process.cwd() });
    writeFile(join(outDir, "finalized-cases.md"), aiResult);
    console.log(`  → ${join(outDir, "finalized-cases.md")}`);
  } catch {
    console.log("  → Improvement skipped (AI unavailable)");
  }

  // Phase 4 — finalize (write back to plan.md format)
  console.log("\n=== Phase 4: finalize ===");
  writeFile(join(outDir, "plan.md"), `# QA Plan — ADO Plan ${planId} Audit\n\nSee ado-audit.md for verdicts and finalized-cases.md for improved cases.\n`);
  console.log(`  → ${join(outDir, "plan.md")}`);

  // Phase 5 — e2e (optional validation of finalized cases)
  console.log("\n=== Phase 5: e2e ===");
  if (isAgentBrowserAvailable()) {
    console.log("  → agent-browser available. Run: qa-agent e2e --input " + join(outDir, "plan.md"));
  } else {
    console.log("  → agent-browser not found. Skip e2e or install agent-browser.");
  }

  // Phase 6 — report
  console.log("\n=== Phase 6: report ===");
  console.log(`  → Audit report: ${join(outDir, "ado-audit.md")}`);
  console.log(`  → Finalized cases: ${join(outDir, "finalized-cases.md")}`);

  console.log(`\n[qa-agent] DONE — artifacts under ${outDir}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.action) {
    case "help":
    case "-h":
    case "--help":
      showHelp();
      break;
    case "run":
      await actionRun(args);
      break;
    case "codegen":
      await actionCodegen(args);
      break;
    case "translate":
      await actionTranslate(args);
      break;
    case "report":
      await actionReport(args);
      break;
    case "history":
      await actionHistory(args);
      break;
    case "snapshot":
      await actionSnapshot(args);
      break;
    default:
      console.error(`[qa-agent] Unknown action: ${args.action}`);
      console.error("[qa-agent] Try: qa-agent help");
      process.exit(1);
  }
}

/** True when this module is the process entry point (not an import). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch(err => {
    console.error(`[qa-agent] Fatal error: ${err.message}`);
    process.exit(1);
  });
}
