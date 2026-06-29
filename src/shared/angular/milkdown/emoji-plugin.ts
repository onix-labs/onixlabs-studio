/**
 * Milkdown plugin for emoji shortcode support.
 *
 * Converts GitHub-style emoji shortcodes (e.g., :smile:, :heart:, :rocket:)
 * into their corresponding Unicode emoji characters.
 *
 * Uses remark-gemoji for shortcode conversion.
 */

import { $remark } from '@milkdown/kit/utils';
import type { $Remark } from '@milkdown/utils';
import type { MilkdownPlugin } from '@milkdown/ctx';
import remarkGemoji from 'remark-gemoji';

/**
 * Remark plugin that converts emoji shortcodes to Unicode emoji.
 * Wraps remark-gemoji for use with Milkdown.
 */
export const remarkEmoji: $Remark<'remarkEmoji', undefined> = $remark(
  'remarkEmoji',
  (): typeof remarkGemoji => remarkGemoji,
);

/**
 * All emoji plugins combined.
 */
export const emojiPlugin: MilkdownPlugin[] = [...remarkEmoji];
