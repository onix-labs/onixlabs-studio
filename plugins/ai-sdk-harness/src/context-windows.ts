// A best-guess context window for a model id, for the endpoints this harness talks to.
//
// ⛔ This lived in core, where it obliged Studio to know which models every provider has (#653). It is
// here because this harness is the one talking to OpenAI-shaped endpoints — which report an id and
// sometimes a display name, and never a capacity. The window rides the reported model now (agent
// protocol 1.10.0), so a guess made here reaches the token meter instead of a 32K default.
//
// A heuristic, and honestly so: the value is editable per model, and an unknown id resolves to a
// conservative default rather than failing. Under-guessing shows a conversation as fuller than it is,
// which is visible and correctable; over-guessing hides that a turn is about to overflow.

/**
 * The context window applied when nothing more specific is known.
 */
export const DEFAULT_CONTEXT_WINDOW: number = 32_768;

/**
 * Known context windows for ids a family rule would get wrong.
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
};

/**
 * Resolves a best-guess context window for a model id: an exact known value, then an explicit size
 * token in the id, then a family rule, then the default.
 * @param id The model id.
 * @returns Returns the context window in tokens.
 */
export function contextWindowFor(id: string): number {
  const key: string = id.toLowerCase();

  // Exact values first, for the ids where the family rule would be wrong — `gpt-4` is 8K where every
  // other `gpt-4…` is 128K, and guessing upward there hides an overflow rather than showing one.
  const known: number | undefined = KNOWN_CONTEXT_WINDOWS[key];
  if (known !== undefined) {
    return known;
  }

  // An explicit size token in the id, such as "…-128k" or "…-1m", which the model's publisher put there
  // precisely to say this.
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
  if (key.includes('grok')) {
    return 256_000;
  }
  if (key.startsWith('gpt-4') || key.startsWith('gpt-5') || /^o[13]\b/.test(key)) {
    return 128_000;
  }
  return DEFAULT_CONTEXT_WINDOW;
}
