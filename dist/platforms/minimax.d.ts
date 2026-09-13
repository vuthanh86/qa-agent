/**
 * Minimax Code platform adapter.
 *
 * Invokes Minimax Code via its CLI.
 * Requires `minimax-code` on PATH.
 */
import { PlatformAdapter, InvokeOptions } from "./types.js";
export declare class MinimaxAdapter implements PlatformAdapter {
    readonly name = "minimax";
    readonly label = "Minimax Code";
    isAvailable(): Promise<boolean>;
    invoke(prompt: string, options?: InvokeOptions): Promise<string>;
}
//# sourceMappingURL=minimax.d.ts.map