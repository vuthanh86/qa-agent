/**
 * DSH (DeepSeek Harness) platform adapter.
 *
 * Invokes DSH's AI agent via the REST API at localhost:3080.
 * Also supports spawning sub-agents when running inside a DSH session.
 */
import { PlatformAdapter, InvokeOptions } from "./types.js";
export declare class DshAdapter implements PlatformAdapter {
    readonly name = "dsh";
    readonly label = "DeepSeek Harness (DSH)";
    isAvailable(): Promise<boolean>;
    invoke(prompt: string, options?: InvokeOptions): Promise<string>;
}
//# sourceMappingURL=dsh.d.ts.map