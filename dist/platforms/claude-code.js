/**
 * Claude Code platform adapter.
 *
 * Invokes Claude Code via the `claude` CLI.
 * Requires `claude` on PATH and an active Claude Code session or API key.
 */
import { execSync, spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export class ClaudeCodeAdapter {
    name = "claude-code";
    label = "Claude Code (Anthropic)";
    async isAvailable() {
        try {
            execSync("claude --version", { stdio: "ignore" });
            return true;
        }
        catch {
            return false;
        }
    }
    async invoke(prompt, options) {
        const workDir = options?.workDir ?? process.cwd();
        const promptFile = join(workDir, ".qa-agent", `claude-prompt-${randomUUID().slice(0, 8)}.md`);
        mkdirSync(join(workDir, ".qa-agent"), { recursive: true });
        writeFileSync(promptFile, prompt, "utf-8");
        return new Promise((resolve, reject) => {
            const args = [
                "-p", // print mode (non-interactive)
                "--print",
                `$(cat "${promptFile}")`,
                ...(options?.model ? [`--model`, options.model] : []),
                ...(options?.maxTokens ? [`--max-tokens`, String(options.maxTokens)] : []),
                ...(options?.extra ?? []),
            ];
            const child = spawn("claude", args, {
                cwd: workDir,
                env: { ...process.env, ...options?.env },
                timeout: options?.timeoutMs ?? 300000,
                stdio: ["ignore", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (d) => { stdout += d.toString(); });
            child.stderr.on("data", (d) => { stderr += d.toString(); });
            child.on("close", (code) => {
                if (code === 0)
                    resolve(stdout);
                else
                    reject(new Error(`claude exited with code ${code}: ${stderr}`));
            });
            child.on("error", reject);
        });
    }
}
//# sourceMappingURL=claude-code.js.map