/**
 * Platform adapter interface — every coding-agent platform implements this.
 *
 * When the qa-agent CLI needs AI reasoning (authoring test cases, auditing plans,
 * driving agent-browser), it generates a prompt and hands it to the adapter.
 * The adapter invokes the platform's agent and returns the result.
 */
/** Auto-detect which platforms are available */
export async function detectPlatform() {
    const adapters = await loadAdapters();
    for (const adapter of adapters) {
        if (await adapter.isAvailable()) {
            return adapter.name;
        }
    }
    return null;
}
/** Load all available platform adapters */
export async function loadAdapters() {
    const adapters = [];
    // Try loading each adapter; skip if dependencies are missing
    try {
        const { DshAdapter } = await import("./dsh.js");
        adapters.push(new DshAdapter());
    }
    catch { /* DSH not available */ }
    try {
        const { ClaudeCodeAdapter } = await import("./claude-code.js");
        adapters.push(new ClaudeCodeAdapter());
    }
    catch { /* Claude Code not available */ }
    try {
        const { GeminiAdapter } = await import("./gemini.js");
        adapters.push(new GeminiAdapter());
    }
    catch { /* Gemini not available */ }
    try {
        const { MinimaxAdapter } = await import("./minimax.js");
        adapters.push(new MinimaxAdapter());
    }
    catch { /* Minimax not available */ }
    return adapters;
}
//# sourceMappingURL=types.js.map