/**
 * History phase — render the QA history graph (HTML + Mermaid).
 *
 * Wraps the existing render-qa-history.mjs logic.
 * Falls back to a simple inline renderer when Node.js is available.
 */
import { execSync } from "node:child_process";
import { writeFile } from "../utils/fs.js";
import { join } from "node:path";
import { homedir } from "node:os";
export function runHistory(options) {
    const { outDir, feature, env, last = 50 } = options;
    // Try the existing render-qa-history.mjs if available
    const legacyScript = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "qa-agent", "scripts", "render-qa-history.mjs");
    try {
        const args = [
            legacyScript,
            "--outDir", outDir,
            "--last", String(last),
            ...(feature ? ["--feature", feature] : []),
            ...(env ? ["--env", env] : []),
        ];
        execSync(`node ${args.join(" ")}`, { stdio: "ignore", timeout: 30000 });
    }
    catch {
        // Fall back to a minimal inline renderer
        renderMinimalHistory(outDir, feature, env, last);
    }
    return {
        htmlPath: join(outDir, "history.html"),
        mermaidPath: join(outDir, "history.mmd"),
    };
}
function renderMinimalHistory(outDir, feature, env, last = 50) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>QA History — ${feature ?? "all"} / ${env ?? "all"}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
    h1 { font-size: 1.5rem; }
    .note { color: #666; font-style: italic; }
    table { border-collapse: collapse; margin-top: 1rem; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    th { background: #f5f5f5; }
    .pass { color: #16a34a; font-weight: bold; }
    .fail { color: #dc2626; font-weight: bold; }
    .skip { color: #6b7280; }
  </style>
</head>
<body>
  <h1>QA History Graph</h1>
  <p class="note">Feature: ${feature ?? "all"} | Env: ${env ?? "all"} | Last ${last} runs</p>
  <p class="note">Install the full renderer: npm install -g qa-agent && qa-agent history --feature "${feature ?? "default"}" --env "${env ?? "qa"}"</p>
</body>
</html>`;
    writeFile(join(outDir, "history.html"), html);
    writeFile(join(outDir, "history.mmd"), `graph TD\n  A[QA History — ${feature ?? "all"} / ${env ?? "all"}]`);
}
//# sourceMappingURL=history.js.map