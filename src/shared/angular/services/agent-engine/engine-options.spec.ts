import type { AiProviderInfo } from '@shared/api/ai-types';
import type { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { engineOptions } from './engine-options';

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
