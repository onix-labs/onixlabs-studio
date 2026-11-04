import { ellipsis, emDash, inputRules, smartQuotes } from '@milkdown/kit/prose/inputrules';
import type { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { $Prose } from '@milkdown/utils';

/**
 * The plugin that makes quotes curly, three dots an ellipsis and two hyphens a dash as they are typed.
 */
export const smartPunctuationPlugin: $Prose = $prose((): Plugin =>
  inputRules({ rules: [...smartQuotes, ellipsis, emDash] }),
);
