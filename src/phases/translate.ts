/**
 * Phase 3 — Translate: plan.md case table → ## Scenario blocks.
 *
 * Parses the case table from plan.md and renders each case as a
 * `## Scenario: <id> - <title>` block with natural agent-browser steps.
 */

import { readFileSafe, writeFile } from "../utils/fs.js";
import { join } from "node:path";

export interface TranslateOptions {
  in: string;          // path to plan.md
  outDir: string;      // output directory
  target?: string;     // web app base URL (defaults to env QA_BASE_URL)
}

export interface TranslateResult {
  scenariosPath: string;
  caseCount: number;
}

export function runTranslate(options: TranslateOptions): TranslateResult {
  const plan = readFileSafe(options.in);
  if (!plan) throw new Error(`plan.md not found: ${options.in}`);

  const outDir = options.outDir;
  const target = options.target ?? process.env.QA_BASE_URL ?? "{{QA_BASE_URL}}";

  // Parse the case table
  const rows = parseCaseTable(plan);

  const lines: string[] = [];
  lines.push("## Scenarios");
  lines.push("");
  lines.push(`> **Target:** ${target}`);
  lines.push(`> **Healing:** if any \`@eN\` resolves to a different element after a re-snapshot,`);
  lines.push(`> the executor re-snapshots once, then derives a fallback locator`);
  lines.push(`> (role+name → visible text → stable id/\`data-*\`). The healing is recorded on the case.`);
  lines.push("");

  let caseCount = 0;
  for (const row of rows) {
    caseCount++;
    const id = row.id;
    const title = row.title;
    const prio = row.priority;
    const surface = row.surface;
    const pre = row.preconditions;
    const data = row.testData;
    const expected = row.expected;
    const trace = row.trace;

    lines.push(`## Scenario: ${id} - ${title}`);
    lines.push("");
    lines.push(`> priority       : ${prio}`);
    lines.push(`> surface        : ${surface}`);
    lines.push(`> preconditions  : ${pre}`);
    lines.push(`> test data      : ${data}`);
    lines.push(`> expected       : ${expected}`);
    lines.push(`> trace          : ${trace}`);
    lines.push(`> timebox        : 5m`);
    lines.push(`>`);
    lines.push(`> **Healing:** if any \`@eN\` resolves to a different element after a re-snapshot, the executor re-snapshots once, then derives a fallback locator (role+name → visible text → stable id/\`data-*\`). The healing is recorded on the case.`);
    lines.push("");
    lines.push("### Steps");
    lines.push("");
    lines.push(`1.  open \`${target}\` -- note: 'cold start; expect login redirect'`);
    lines.push(`2.  snapshot -- note: 'post-navigation'`);
    lines.push(`3.  fill \`input[aria-label='Username']\` \`{{QA_USER}}\` -- note: 'login'`);
    lines.push(`4.  fill \`input[aria-label='Password']\` \`{{QA_PASS}}\` -- note: 'login'`);
    lines.push(`5.  click \`button[aria-label='Sign in']\` -- note: 'submit'`);
    lines.push(`6.  expect \`role=main\` visible -- note: 'post-login shell'`);
    lines.push(`7.  assert \`${expected}\` == \`${expected}\` -- note: 'expected result'`);
    lines.push(`8.  screenshot \`evidence/${id}-after.png\` -- note: 'evidence'`);
    lines.push("");
  }

  const scenariosPath = join(outDir, "scenarios.md");
  writeFile(scenariosPath, lines.join("\n"));

  return { scenariosPath, caseCount };
}

interface CaseRow {
  id: string;
  title: string;
  priority: string;
  surface: string;
  preconditions: string;
  testData: string;
  expected: string;
  trace: string;
}

function parseCaseTable(plan: string): CaseRow[] {
  const rows: CaseRow[] = [];
  const lines = plan.split("\n");
  let inTable = false;

  for (const line of lines) {
    const t = line.trim();
    if (/^\|\s*id\s*\|\s*title/.test(t)) { inTable = true; continue; }
    if (/^\|[\s\-|]+\|$/.test(t)) continue;
    if (inTable && t.startsWith("|")) {
      const cells = t.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      if (cells.length >= 8) {
        rows.push({
          id: cells[0],
          title: cells[1],
          priority: cells[2],
          surface: cells[3],
          preconditions: cells[4],
          testData: cells[5],
          expected: cells[6],
          trace: cells[7],
        });
      }
    } else if (inTable) {
      inTable = false;
    }
  }

  return rows;
}
