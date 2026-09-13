/**
 * Phase 5 — Report: results.json → results.md + summary.html.
 *
 * Reads the machine-readable results and produces the human-readable report.
 * The AI adds defects and the ship/no-ship recommendation by reading prompts/report.md.
 */
import { readFileSafe, writeFile } from "../utils/fs.js";
import { join } from "node:path";
export function runReport(options) {
    const resultsPath = join(options.runDir, "results.json");
    const raw = readFileSafe(resultsPath);
    if (!raw)
        throw new Error(`results.json not found in ${options.runDir}`);
    const results = JSON.parse(raw);
    const { summary, cases, defects } = results;
    const lines = [];
    lines.push(`# QA report — ${results.runId}`);
    lines.push("");
    lines.push(`**Scope:** ${results.scope}  **Depth:** ${results.depth}  **Env:** ${results.env ?? "N/A"}`);
    lines.push(`**Date:** ${results.date}`);
    lines.push("");
    // History graph reference
    if (!options.skipHistory) {
        lines.push("## History graph");
        lines.push("");
        lines.push("Open `history.html` in a browser for the pass-rate trend + per-TC timeline.");
        lines.push("");
    }
    // Summary
    lines.push("## Summary");
    lines.push("");
    lines.push("| total | passed | failed | skipped | duration |");
    lines.push("|---|---|---|---|---|");
    lines.push(`| ${summary.total} | ${summary.passed} | ${summary.failed} | ${summary.skipped} | ${summary.durationMs}ms |`);
    lines.push("");
    // Pass rate
    const passRate = summary.total > 0 ? ((summary.passed / summary.total) * 100).toFixed(1) : "0.0";
    lines.push(`**Pass rate:** ${passRate}%`);
    lines.push("");
    // Case results
    lines.push("## Case results");
    lines.push("");
    lines.push("| id | title | priority | status | duration | regression | root cause |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const c of cases) {
        const dur = `${c.durationMs}ms`;
        const reg = c.regression ? "⚠️ YES" : "";
        const rc = c.rootCause ?? (c.reason ?? "");
        lines.push(`| ${c.id} | ${c.title} | ${c.priority} | ${c.status} | ${dur} | ${reg} | ${rc} |`);
    }
    lines.push("");
    // Skipped cases
    const skipped = cases.filter(c => c.status === "SKIP");
    if (skipped.length > 0) {
        lines.push("### Skipped cases");
        lines.push("");
        for (const c of skipped) {
            lines.push(`- **${c.id}** — ${c.reason ?? "No reason recorded"}`);
        }
        lines.push("");
    }
    // Regressions
    const regressions = cases.filter(c => c.regression);
    if (regressions.length > 0) {
        lines.push("## ⚠️ Regressions (passed previously)");
        lines.push("");
        for (const c of regressions) {
            lines.push(`- **${c.id}** — ${c.title} — last status was PASS, now ${c.status}`);
        }
        lines.push("");
    }
    // Flaky cases
    const flaky = cases.filter(c => c.flaky);
    if (flaky.length > 0) {
        lines.push("## Flaky cases (PASS on retry)");
        lines.push("");
        for (const c of flaky) {
            lines.push(`- **${c.id}** — ${c.title} — first run FAIL, retry PASS`);
        }
        lines.push("");
    }
    // Defects
    if (defects.length > 0) {
        lines.push("## Defects");
        lines.push("");
        for (const d of defects) {
            lines.push(`### ${d.id} — ${d.severity} — ${d.title}`);
            lines.push("");
            lines.push(`- **Case:** ${d.case}`);
            lines.push(`- **Steps:** ${d.steps}`);
            lines.push(`- **Expected:** ${d.expected}`);
            lines.push(`- **Actual:** ${d.actual}`);
            if (d.evidence.length > 0) {
                lines.push(`- **Evidence:** ${d.evidence.join(", ")}`);
            }
            lines.push("");
        }
    }
    // Ship / no-ship
    lines.push("## Ship / No-Ship");
    lines.push("");
    const hasFailure = summary.failed > 0;
    const hasS1 = defects.some(d => d.severity === "S1");
    if (hasS1) {
        lines.push("**🚫 NO-SHIP** — S1 defects present.");
    }
    else if (hasFailure) {
        lines.push("**⚠️ SHIP WITH CAUTION** — failures present, review root causes.");
    }
    else {
        lines.push("**✅ SHIP** — all cases pass, no blocking defects.");
    }
    lines.push("");
    // AI task block
    lines.push("---");
    lines.push("");
    lines.push("## AI Task: Review results and draft defects");
    lines.push("");
    lines.push("Review the case results above. For each FAIL/ERROR:");
    lines.push("1. Determine the root cause from the evidence");
    lines.push("2. Draft a defect with repro steps, expected, actual, severity (S1/S2/S3)");
    lines.push("3. Update the ship/no-ship recommendation with reasoning");
    lines.push("");
    lines.push("Add defects to `defects.md` and update `results.json`.");
    const reportPath = join(options.runDir, "results.md");
    writeFile(reportPath, lines.join("\n"));
    return { reportPath };
}
//# sourceMappingURL=report.js.map