/**
 * Gemini CLI platform adapter.
 *
 * Invokes Gemini via the `gemini` CLI.
 * Requires `gemini` on PATH and a configured Google AI API key.
 */
import { PlatformAdapter, InvokeOptions } from "./types.js";
export declare class GeminiAdapter implements PlatformAdapter {
    readonly name = "gemini";
    readonly label = "Gemini CLI (Google)";
    isAvailable(): Promise<boolean>;
    invoke(prompt: string, options?: InvokeOptions): Promise<string>;
}
//# sourceMappingURL=gemini.d.ts.map