/**
 * Claude Code platform adapter.
 *
 * Invokes Claude Code via the `claude` CLI.
 * Requires `claude` on PATH and an active Claude Code session or API key.
 */
import { PlatformAdapter, InvokeOptions } from "./types.js";
export declare class ClaudeCodeAdapter implements PlatformAdapter {
    readonly name = "claude-code";
    readonly label = "Claude Code (Anthropic)";
    isAvailable(): Promise<boolean>;
    invoke(prompt: string, options?: InvokeOptions): Promise<string>;
}
//# sourceMappingURL=claude-code.d.ts.map