// Merging what a provider reported into a connection's own model list.
//
// What is left in core after the providers moved out (#653): the *merge*, which is a decision about the
// user's list rather than about any provider — a discovery adds, it never replaces, because a list the
// user has curated is not something a refresh should overwrite.
//
// ⛔ Nothing here names a provider, a company, or a model. The table of `gpt-4o`, `o3` and
// `claude-opus-4-8` that used to resolve a context window from an id lived in core and was the last
// reason core had to know which models exist; a harness reports the window itself now (protocol
// 1.10.0), and what remains is a single default for a harness that did not.

import type { AiModelInfo } from '@shared/api/ai-types';

/**
 * The context window applied to a discovered model whose harness did not report one.
 *
 * Deliberately conservative and deliberately generic: it is the denominator of the token readout, so
 * under-guessing shows a conversation as fuller than it is — visible, and correctable per model — while
 * over-guessing hides that a turn is about to overflow. It names no provider, which is the point.
 */
export const DEFAULT_CONTEXT_WINDOW: number = 32_768;

/**
 * A model as a provider reported it.
 */
export interface ReportedModel {
  /**
   * Gets the model identifier, as the provider would be asked to run it.
   */
  readonly id: string;

  /**
   * Gets the display name, or undefined to show the identifier.
   */
  readonly label?: string;

  /**
   * Gets the context window in tokens, or undefined when the provider did not say.
   */
  readonly contextWindow?: number;
}

/**
 * Merges discovered models into a connection's list, keeping every model the user already had.
 *
 * Additive on purpose. A model already in the list is left exactly as it is — the user may have renamed
 * it, pinned it, or corrected its context window, and a refresh that discarded that would punish them
 * for using the feature.
 * @param existing The connection's current models.
 * @param discovered The models the provider reported.
 * @returns Returns the merged list.
 */
export function mergeModels(
  existing: readonly AiModelInfo[],
  discovered: readonly ReportedModel[],
): AiModelInfo[] {
  const seen: Set<string> = new Set<string>(existing.map((model: AiModelInfo): string => model.id));
  const merged: AiModelInfo[] = [...existing];
  for (const model of discovered) {
    if (seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    merged.push({
      id: model.id,
      label: model.label ?? model.id,
      contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    });
  }
  return merged;
}
