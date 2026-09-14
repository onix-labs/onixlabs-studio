import { normalizeLanguage } from '@shared/api/ai-types';

/**
 * The most characters either standing-prompt layer may carry (#300). The renderer composes the text
 * from the user's own profiles, so the bound is not against the user but against an untrusted page:
 * a prompt is sent to a paid model, and an unbounded string is a way to spend the user's tokens.
 */
export const PROMPT_EXTRA_LIMIT: number = 32 * 1024;

/**
 * Matches a language identifier as Monaco reports one: a short lower-case token.
 */
const LANGUAGE_PATTERN: RegExp = /^[a-z0-9][a-z0-9+._-]{0,63}$/;

/**
 * Reads a standing-prompt layer out of an untrusted run request.
 * @param value The value the renderer sent.
 * @returns Returns the trimmed text, cut at the limit, or empty for anything that is not a string.
 */
export function sanitizePromptExtra(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed: string = value.trim();
  return trimmed.length > PROMPT_EXTRA_LIMIT ? trimmed.slice(0, PROMPT_EXTRA_LIMIT) : trimmed;
}

/**
 * Reads the owning document's language out of an untrusted run request.
 * @param value The value the renderer sent.
 * @returns Returns the normalised identifier, or null for anything that is not one.
 */
export function sanitizeLanguage(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const language: string = normalizeLanguage(value);
  return LANGUAGE_PATTERN.test(language) ? language : null;
}
