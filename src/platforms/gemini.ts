/**
 * Gemini CLI platform adapter.
 *
 * Invokes Gemini via the `gemini` CLI.
 * Requires `gemini` on PATH and a configured Google AI API key.
 */

import { PlatformAdapter, InvokeOptions } from "./types.js";
import { execSync, spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class GeminiAdapter implements PlatformAdapter {
  readonly name = "gemini";
  readonly label = "Gemini CLI (Google)";

  async isAvailable(): Promise<boolean> {
    try {
      execSync("gemini --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async invoke(prompt: string, options?: InvokeOptions): Promise<string> {
    const workDir = options?.workDir ?? process.cwd();
    const promptFile = join(workDir, ".qa-agent", `gemini-prompt-${randomUUID().slice(0, 8)}.md`);
    mkdirSync(join(workDir, ".qa-agent"), { recursive: true });
    writeFileSync(promptFile, prompt, "utf-8");

    return new Promise((resolve, reject) => {
      const args = [
        "chat",
        "--prompt-file", promptFile,
        ...(options?.model ? [`--model`, options.model] : []),
        ...(options?.extra ?? []),
      ];

      const child = spawn("gemini", args, {
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
        else reject(new Error(`gemini exited with code ${code}: ${stderr}`));
      });

      child.on("error", reject);
    });
  }
}
