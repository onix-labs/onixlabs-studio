// Resolves a best-guess context window (in tokens) for a model id, used to seed a newly-discovered
// model's token-meter denominator. This is a heuristic starting point, not authority: the value is
// editable per model, and an unknown id resolves to a safe default rather than failing. Pure — free of
// Electron and Node imports so it is unit-testable.

/**
 * The context window applied when nothing more specific is known. A modern, conservative default the
 * user can raise for a specific model.
 */
export const DEFAULT_CONTEXT_WINDOW: number = 32_768;

/**
 * Known context windows for specific model ids (lower-cased), where the id alone does not imply the
 * size. Family heuristics in {@link resolveContextWindow} cover the rest.
 */
const KNOWN_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  o1: 200_000,
  'o1-mini': 128_000,
  o3: 200_000,
  'o3-mini': 200_000,
  'claude-opus-4-8': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000,
};

/**
 * Resolves a best-guess context window for a model id: an exact known value, then an explicit size
 * token embedded in the id (for example `-128k` or `-1m`), then a family heuristic, then the default.
 * @param id The model id.
 * @returns Returns the resolved context window, in tokens.
 */
export function resolveContextWindow(id: string): number {
  const key: string = id.toLowerCase();

  const known: number | undefined = KNOWN_CONTEXT_WINDOWS[key];
  if (known !== undefined) {
    return known;
  }

  // An explicit size token in the id, such as "...-128k" or "...-1m".
  const size: RegExpExecArray | null = /(\d+)\s*([km])(?![a-z0-9])/.exec(key);
  if (size !== null) {
    const value: number = Number(size[1]);
    return size[2] === 'm' ? value * 1_000_000 : value * 1_000;
  }

  if (key.includes('gemini')) {
    return 1_000_000;
  }
  if (key.startsWith('qwen3')) {
    return 40_960;
  }
  if (key.includes('qwen2.5') || key.includes('qwen2')) {
    return 32_768;
  }
  if (key.includes('deepseek')) {
    return 64_000;
  }
  if (key.includes('llama')) {
    return 128_000;
  }
  if (key.startsWith('gpt-4')) {
    return 128_000;
  }
  // Claude, including the SDK's bare family aliases (`opus`, `sonnet`, `haiku`) and the `default`
  // alias, which carry no `claude-` prefix — without this they would fall to the 32k default and a
  // 1M-window model would read as full at a fraction of its capacity. A conservative family floor; the
  // exact window comes from the model's bracketed hint or its description where either is present.
  if (key.startsWith('claude') || /^(opus|sonnet|haiku|default)\b/.test(key)) {
    return 200_000;
  }
  return DEFAULT_CONTEXT_WINDOW;
}
