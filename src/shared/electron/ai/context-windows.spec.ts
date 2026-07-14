import { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } from './context-windows';

describe('resolveContextWindow', () => {
  it('returnsExactKnownValues', () => {
    expect(resolveContextWindow('gpt-4o')).toBe(128_000);
    expect(resolveContextWindow('claude-haiku-4-5')).toBe(200_000);
    expect(resolveContextWindow('o3')).toBe(200_000);
  });

  it('isCaseInsensitive', () => {
    expect(resolveContextWindow('GPT-4o')).toBe(128_000);
  });

  it('readsAnExplicitSizeTokenInTheId', () => {
    expect(resolveContextWindow('some-model-128k')).toBe(128_000);
    expect(resolveContextWindow('big-model-1m')).toBe(1_000_000);
  });

  it('appliesFamilyHeuristics', () => {
    expect(resolveContextWindow('qwen3:8b')).toBe(40_960);
    expect(resolveContextWindow('qwen2.5-coder:7b')).toBe(32_768);
    expect(resolveContextWindow('gemini-1.5-pro')).toBe(1_000_000);
    expect(resolveContextWindow('deepseek-chat')).toBe(64_000);
    expect(resolveContextWindow('llama-3.3-70b')).toBe(128_000);
  });

  it('fallsBackToTheDefaultForUnknownIds', () => {
    expect(resolveContextWindow('some-unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});
