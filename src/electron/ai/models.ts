import type { AiModelInfo } from '../../shared/ai-types';

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
