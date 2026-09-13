/**
 * Claude Code platform adapter.
 *
 * Invokes Claude Code via the `claude` CLI.
 * Requires `claude` on PATH and an active Claude Code session or API key.
 */

import { PlatformAdapter, InvokeOptions } from "./types.js";
import { execSync, spawn } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export class ClaudeCodeAdapter implements PlatformAdapter {
  readonly name = "claude-code";
  readonly label = "Claude Code (Anthropic)";

  async isAvailable(): Promise<boolean> {
    try {
      execSync("claude --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async invoke(prompt: string, options?: InvokeOptions): Promise<string> {
    const workDir = options?.workDir ?? process.cwd();
    const promptFile = join(workDir, ".qa-agent", `claude-prompt-${randomUUID().slice(0, 8)}.md`);
    mkdirSync(join(workDir, ".qa-agent"), { recursive: true });
    writeFileSync(promptFile, prompt, "utf-8");

    return new Promise((resolve, reject) => {
      const args = [
        "-p",            // print mode (non-interactive)
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

      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`claude exited with code ${code}: ${stderr}`));
      });

      child.on("error", reject);
    });
  }
}
