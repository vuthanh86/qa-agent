/**
 * Platform adapter interface — every coding-agent platform implements this.
 *
 * When the qa-agent CLI needs AI reasoning (authoring test cases, auditing plans,
 * driving agent-browser), it generates a prompt and hands it to the adapter.
 * The adapter invokes the platform's agent and returns the result.
 */

export interface PlatformAdapter {
  /** Short name used in --platform flag: "dsh" | "claude-code" | "gemini" | "minimax" */
  readonly name: string;

  /** Human-readable label for logs and prompts */
  readonly label: string;

  /**
   * Invoke the platform's AI agent with a prompt.
   *
   * @param prompt - The full prompt text (typically generated from prompts/*.md + context).
   * @param options - Platform-specific options (model, max tokens, working directory, etc.).
   * @returns The AI's text response.
   */
  invoke(prompt: string, options?: InvokeOptions): Promise<string>;

  /** Check whether this platform is available on the current machine. */
  isAvailable(): Promise<boolean>;
}

export interface InvokeOptions {
  /** Working directory for the invocation */
  workDir?: string;

  /** Model override */
  model?: string;

  /** Max tokens for the response */
  maxTokens?: number;

  /** Additional environment variables */
  env?: Record<string, string>;

  /** Timeout in milliseconds */
  timeoutMs?: number;

  /** Extra platform-specific flags */
  extra?: string[];
}

/** Result from a platform invocation */
export interface PlatformResult {
  platform: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

/** Auto-detect which platforms are available */
export async function detectPlatform(): Promise<string | null> {
  const adapters = await loadAdapters();
  for (const adapter of adapters) {
    if (await adapter.isAvailable()) {
      return adapter.name;
    }
  }
  return null;
}

/** Load all available platform adapters */
export async function loadAdapters(): Promise<PlatformAdapter[]> {
  const adapters: PlatformAdapter[] = [];

  // Try loading each adapter; skip if dependencies are missing
  try {
    const { DshAdapter } = await import("./dsh.js");
    adapters.push(new DshAdapter());
  } catch { /* DSH not available */ }

  try {
    const { ClaudeCodeAdapter } = await import("./claude-code.js");
    adapters.push(new ClaudeCodeAdapter());
  } catch { /* Claude Code not available */ }

  try {
    const { GeminiAdapter } = await import("./gemini.js");
    adapters.push(new GeminiAdapter());
  } catch { /* Gemini not available */ }

  try {
    const { MinimaxAdapter } = await import("./minimax.js");
    adapters.push(new MinimaxAdapter());
  } catch { /* Minimax not available */ }

  return adapters;
}
