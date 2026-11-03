import { TestBed } from '@angular/core/testing';
import type { ChoiceOption } from '@shared/angular/services/settings/settings-schema';
import { SettingOptions } from './setting-options';

describe('SettingOptions', () => {
  it('defaultLanguage_offersPlainTextFirst_thenEveryLanguageOnce', () => {
    const options: readonly ChoiceOption[] =
      TestBed.inject(SettingOptions).resolve('textEditor.defaultLanguage') ?? [];

    expect(options[0]).toEqual({ value: 'plaintext', label: 'Plain Text' });
    const values: readonly string[] = options.map((option: ChoiceOption): string => option.value);
    expect(values).toContain('typescript');
    expect(values.filter((value: string): boolean => value === 'plaintext')).toHaveLength(1);
  });
});
