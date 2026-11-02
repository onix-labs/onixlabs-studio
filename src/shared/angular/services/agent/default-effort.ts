import { AI_EFFORT_LEVELS, AiEffort } from '@shared/api/ai/ai-provider-types';
import type { DefaultReasoningEffort } from '@shared/angular/services/settings/settings-registry';

/**
 * Resolves the Default Reasoning Effort setting against what a provider offers: the chosen level when
 * the provider has it, else the nearest level it does have (the lower on a tie, the cheaper of two
 * equally close). The provider's own default — or a provider with no effort control — is no level.
 * @param wanted The setting's value.
 * @param offered The levels the provider supports.
 * @returns Returns the level to run at, or null for the provider's default.
 */
export function defaultEffort(
  wanted: DefaultReasoningEffort,
  offered: readonly AiEffort[],
): AiEffort | null {
  if (wanted === 'provider' || offered.length === 0) {
    return null;
  }
  const target: number = AI_EFFORT_LEVELS.indexOf(wanted);
  let best: AiEffort | null = null;
  let bestDistance: number = Number.POSITIVE_INFINITY;
  for (const level of AI_EFFORT_LEVELS) {
    if (!offered.includes(level)) {
      continue;
    }
    const distance: number = Math.abs(AI_EFFORT_LEVELS.indexOf(level) - target);
    if (distance < bestDistance) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}
