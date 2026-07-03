import type { AiModelInfo } from '@shared/ai-types';

// The Anthropic model catalogue both providers offer. Claude runs them through the Agent SDK; Vercel
// runs the same models through `@ai-sdk/anthropic` (the seam to additional back-ends later). The ids
// are the exact model strings the SDKs accept — never date-suffixed.

/**
 * The Anthropic models a turn can run with, in display order (most to least capable).
 */
export const ANTHROPIC_MODELS: readonly AiModelInfo[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

/**
 * The identifier of the default Anthropic model (always present in {@link ANTHROPIC_MODELS}).
 */
export const DEFAULT_ANTHROPIC_MODEL: string = 'claude-opus-4-8';

// The local models the Ollama provider offers. These are Ollama model tags the user must have pulled
// (`ollama pull <tag>`); the ids are the exact tags Ollama serves. Until dynamic discovery lands
// (querying the daemon's installed models), the list is a hand-picked set of capable local coders.

/**
 * The Ollama models a turn can run with, in display order (most to least capable).
 */
export const OLLAMA_MODELS: readonly AiModelInfo[] = [
  { id: 'qwen2.5-coder:14b', label: 'Qwen2.5 Coder 14B' },
  { id: 'qwen2.5-coder:7b', label: 'Qwen2.5 Coder 7B' },
  { id: 'qwen3:8b', label: 'Qwen3 8B' },
];

/**
 * The identifier of the default Ollama model (always present in {@link OLLAMA_MODELS}).
 */
export const DEFAULT_OLLAMA_MODEL: string = 'qwen2.5-coder:7b';
