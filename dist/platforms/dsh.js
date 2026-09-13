/**
 * DSH (DeepSeek Harness) platform adapter.
 *
 * Invokes DSH's AI agent via the REST API at localhost:3080.
 * Also supports spawning sub-agents when running inside a DSH session.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const DSH_API_BASE = process.env.DSH_API_URL ?? "http://127.0.0.1:3080";
export class DshAdapter {
    name = "dsh";
    label = "DeepSeek Harness (DSH)";
    async isAvailable() {
        try {
            const resp = await fetch(`${DSH_API_BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
            return resp.ok;
        }
        catch {
            return false;
        }
    }
    async invoke(prompt, options) {
        const workDir = options?.workDir ?? process.cwd();
        const promptFile = join(workDir, ".qa-agent", `prompt-${randomUUID().slice(0, 8)}.md`);
        // Write prompt to file for the agent to read
        mkdirSync(join(workDir, ".qa-agent"), { recursive: true });
        writeFileSync(promptFile, prompt, "utf-8");
        // Strategy 1: Try DSH REST API to send message to current session
        try {
            const resp = await fetch(`${DSH_API_BASE}/api/agent/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: `Read and execute the qa-agent task at: ${promptFile}\n\nWhen done, write your result to: ${promptFile}.result.md`,
                    timeout: options?.timeoutMs ?? 300000,
                }),
                signal: AbortSignal.timeout(options?.timeoutMs ?? 300000),
            });
            if (resp.ok) {
                const result = await resp.text();
                return result;
            }
        }
        catch {
            // Fall through to strategy 2
        }
        // Strategy 2: If running inside DSH, write prompt + instructions to stdout
        // The DSH AI will see this output and act on it
        const instructions = `
[qa-agent] DSH adapter: prompt written to ${promptFile}
[qa-agent] Read this file and execute the task, then write your result to ${promptFile}.result.md
[qa-agent] When done, the CLI will read the result and continue.
`;
        console.log(instructions);
        // Wait for result file (poll)
        const resultFile = `${promptFile}.result.md`;
        const start = Date.now();
        const timeout = options?.timeoutMs ?? 300000;
        while (Date.now() - start < timeout) {
            try {
                const { readFileSync } = await import("node:fs");
                const result = readFileSync(resultFile, "utf-8");
                if (result.trim())
                    return result;
            }
            catch {
                // File not written yet
            }
            await new Promise(r => setTimeout(r, 2000));
        }
        throw new Error(`DSH adapter timed out waiting for result at ${resultFile}`);
    }
}
//# sourceMappingURL=dsh.js.map