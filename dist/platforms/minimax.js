/**
 * Minimax Code platform adapter.
 *
 * Invokes Minimax Code via its CLI.
 * Requires `minimax-code` on PATH.
 */
import { execSync, spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export class MinimaxAdapter {
    name = "minimax";
    label = "Minimax Code";
    async isAvailable() {
        try {
            execSync("minimax-code --version", { stdio: "ignore" });
            return true;
        }
        catch {
            return false;
        }
    }
    async invoke(prompt, options) {
        const workDir = options?.workDir ?? process.cwd();
        const promptFile = join(workDir, ".qa-agent", `minimax-prompt-${randomUUID().slice(0, 8)}.md`);
        mkdirSync(join(workDir, ".qa-agent"), { recursive: true });
        writeFileSync(promptFile, prompt, "utf-8");
        return new Promise((resolve, reject) => {
            const args = [
                "run",
                "--file", promptFile,
                ...(options?.model ? [`--model`, options.model] : []),
                ...(options?.extra ?? []),
            ];
            const child = spawn("minimax-code", args, {
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
                    reject(new Error(`minimax-code exited with code ${code}: ${stderr}`));
            });
            child.on("error", reject);
        });
    }
}
//# sourceMappingURL=minimax.js.map