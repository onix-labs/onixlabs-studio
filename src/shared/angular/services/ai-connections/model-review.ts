import type { AiModelInfo } from '@shared/api/ai-types';

// Reviews a configuration's models against what its provider offers now (#866).
//
// ⛔ Two rules, both the user's:
//   - **Nothing is added without asking.** A review only *finds* new models; adding them is an action
//     the user takes, from a notification or from Discover in settings.
//   - **Nothing is removed, ever.** A model the provider stops offering is marked retired — the picker
//     disables it — and stays in the list until the user deletes it in settings.

/**
 * Describes what a review found.
 */
export interface ModelReview {
  /**
   * Gets the offered models the configuration does not have and the user has not turned down, in the
   * order they were offered.
   */
  readonly added: readonly AiModelInfo[];

  /**
   * Gets the configuration's own list with each model's retired flag brought up to date, in its own
   * order. Unchanged when nothing was discovered.
   */
  readonly models: readonly AiModelInfo[];

  /**
   * Gets the ids of the models this review newly marked retired.
   */
  readonly retired: readonly string[];
}

/**
 * Describes what the provider offers now.
 */
export interface OfferedModels {
  /**
   * Gets the models the provider's harness discovered for the account, or null when it was not asked
   * or could not answer.
   */
  readonly discovered: readonly AiModelInfo[] | null;

  /**
   * Gets the models the installed plugin's manifest lists.
   */
  readonly manifest: readonly AiModelInfo[];
}

/**
 * Reviews a configuration's models against what its provider offers.
 *
 * Discovery speaks for the account, so when it answered it is the only source of new models — the
 * manifest is the plugin author's guess at release time, and offering a model from it that discovery
 * does not list is offering one the account cannot run. Without discovery, the manifest is all there
 * is. Only discovery retires a model: a manifest that stops listing one says nothing about the account.
 * @param current The configuration's models.
 * @param offered What the provider offers.
 * @param dismissed The model ids the user turned down, which are not offered again.
 * @returns Returns what the review found.
 */
export function reviewModels(
  current: readonly AiModelInfo[],
  offered: OfferedModels,
  dismissed: readonly string[],
): ModelReview {
  const source: readonly AiModelInfo[] = offered.discovered ?? offered.manifest;
  const skip: Set<string> = new Set<string>([
    ...current.map((model: AiModelInfo): string => model.id),
    ...dismissed,
  ]);
  const added: AiModelInfo[] = [];
  for (const model of source) {
    if (!skip.has(model.id)) {
      skip.add(model.id);
      added.push(offeredModel(model));
    }
  }
  if (offered.discovered === null) {
    return { added, models: current, retired: [] };
  }
  const listed: Set<string> = new Set<string>(
    offered.discovered.map((model: AiModelInfo): string => model.id),
  );
  const retired: string[] = [];
  const models: AiModelInfo[] = current.map((model: AiModelInfo): AiModelInfo => {
    if (model.manual === true) {
      return model;
    }
    if (!listed.has(model.id)) {
      if (model.retired !== true) {
        retired.push(model.id);
      }
      return model.retired === true ? model : { ...model, retired: true };
    }
    if (model.retired === true) {
      // Offered again: a provider can bring a model back, or an account can regain one.
      return offeredAgain(model);
    }
    return model;
  });
  return { added, models, retired };
}

/**
 * Clears a model's retired mark, keeping everything else the user set on it.
 * @param model The model.
 * @returns Returns the model, no longer retired.
 */
export function offeredAgain(model: AiModelInfo): AiModelInfo {
  const restored: { -readonly [K in keyof AiModelInfo]: AiModelInfo[K] } = { ...model };
  delete restored.retired;
  return restored;
}

/**
 * Appends models to a configuration's list, after its own.
 * @param current The configuration's models.
 * @param added The models to append.
 * @returns Returns the new list.
 */
export function appendModels(
  current: readonly AiModelInfo[],
  added: readonly AiModelInfo[],
): readonly AiModelInfo[] {
  const have: Set<string> = new Set<string>(current.map((model: AiModelInfo): string => model.id));
  return [...current, ...added.filter((model: AiModelInfo): boolean => !have.has(model.id))];
}

/**
 * Names models for a sentence: `A`, `A and B`, or `A, B and C`.
 * @param models The models.
 * @returns Returns their labels, joined.
 */
export function modelNames(models: readonly AiModelInfo[]): string {
  const labels: readonly string[] = models.map((model: AiModelInfo): string => model.label);
  return labels.length <= 1
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Takes an offered model as the configuration will hold it: the user's own flags belong to the
 * user's list, not to what a provider or manifest said.
 * @param model The offered model.
 * @returns Returns the model without per-user flags.
 */
function offeredModel(model: AiModelInfo): AiModelInfo {
  return { id: model.id, label: model.label, contextWindow: model.contextWindow };
}
