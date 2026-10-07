import type { AiProviderInfo } from '@shared/api/ai-types';
import type { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { engineOptions, startingModel } from './engine-options';

describe('startingModel', () => {
  /**
   * Builds a Codex provider whose default is Sol.
   * @param solRetired Whether Sol is retired.
   * @returns Returns the provider.
   */
  function codex(solRetired: boolean): AiProviderInfo {
    return {
      id: 'openai-1',
      label: 'Codex',
      available: true,
      detail: '',
      defaultModelId: 'sol',
      models: [
        { id: 'sol', label: 'Sol', contextWindow: 1, ...(solRetired ? { retired: true } : {}) },
        { id: 'terra', label: 'Terra', contextWindow: 1 },
      ],
    };
  }

  it('startsOnTheDefault', () => {
    expect(startingModel(codex(false))).toBe('sol');
  });

  it('startsOnTheFirstModelStillOffered_whenTheDefaultIsRetired', () => {
    // #866: the saved default is the user's and is left alone, but a new conversation must not
    // start on a model the provider no longer runs.
    expect(startingModel(codex(true))).toBe('terra');
  });

  it('keepsTheDefault_whenNothingElseIsOffered', () => {
    const only: AiProviderInfo = { ...codex(true), models: [codex(true).models[0]] };

    expect(startingModel(only)).toBe('sol');
    expect(startingModel(undefined)).toBe('');
  });
});

describe('engineOptions', () => {
  it('disablesARetiredModel_butStillShowsIt', () => {
    // ⛔ #866: the provider no longer runs it, so it cannot be picked — but it stays in the list until
    // the user removes it in settings, and a conversation already on it shows why.
    const codex: AiProviderInfo = {
      id: 'openai-1',
      label: 'Codex',
      available: true,
      detail: '',
      defaultModelId: 'sol',
      models: [
        { id: 'sol', label: 'GPT-5.6-Sol', contextWindow: 1, retired: true },
        { id: 'terra', label: 'GPT-5.6-Terra', contextWindow: 1 },
      ],
    };

    const options: readonly DropdownOption[] = engineOptions([codex]);

    expect(options).toEqual([
      {
        value: 'openai-1::sol',
        label: 'GPT-5.6-Sol (no longer offered)',
        group: 'Codex',
        disabled: true,
      },
      { value: 'openai-1::terra', label: 'GPT-5.6-Terra', group: 'Codex' },
    ]);
  });
});
