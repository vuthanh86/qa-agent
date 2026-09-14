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
        const timeoutMs = options?.timeoutMs ?? 300000;
        return new Promise((resolve, reject) => {
            // The prompt is delivered on stdin. It cannot be passed as an argument:
            // plan prompts run to tens of KB and would exceed the command-line limit,
            // and the CLI has no flag for reading a prompt from a file.
            // `maxTokens` is ignored — the claude CLI exposes no such option.
            const args = [
                "--print", // non-interactive
                ...(options?.model ? [`--model`, options.model] : []),
                ...(options?.extra ?? []),
            ];
            const child = spawn("claude", args, {
                cwd: workDir,
                env: { ...process.env, ...options?.env },
                timeout: timeoutMs,
                stdio: ["pipe", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (d) => { stdout += d.toString(); });
            child.stderr.on("data", (d) => { stderr += d.toString(); });
            child.on("close", (code, signal) => {
                if (code === 0) {
                    resolve(stdout);
                }
                else if (signal) {
                    // A null exit code with a signal means the process was killed —
                    // almost always the spawn timeout rather than a CLI error.
                    reject(new Error(`claude was terminated by ${signal} after ${timeoutMs}ms; ` +
                        `raise the timeout with --timeboxMs if the task needs longer`));
                }
                else {
                    reject(new Error(`claude exited with code ${code}: ${stderr.trim() || "no stderr output"}`));
                }
            });
            child.on("error", reject);
            // A child that dies before reading stdin surfaces as EPIPE here.
            child.stdin.on("error", reject);
            child.stdin.end(prompt);
        });
    }
}
//# sourceMappingURL=claude-code.js.map