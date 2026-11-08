import type { LspServerSettingDescriptor } from '@shared/api/lsp-channels';
import type { LanguageServerDescriptor } from './language-server-descriptor';
import { languageServerCatalogue } from './language-server-catalogue';
import {
  LspServerSettingValues,
  pushedSettings,
  startupOptions,
  withDeclaredDefaults,
} from './lsp-server-settings';

/**
 * Finds the TypeScript server's descriptor in the catalogue.
 * @returns Returns the descriptor.
 */
function typescript(): LanguageServerDescriptor {
  const found: LanguageServerDescriptor | undefined = languageServerCatalogue().find(
    (descriptor: LanguageServerDescriptor): boolean => descriptor.id === 'typescript',
  );
  if (found === undefined) {
    throw new Error('The catalogue has no TypeScript server');
  }
  return found;
}

/**
 * Gets the TypeScript server's declared settings.
 * @returns Returns the settings.
 */
function settings(): readonly LspServerSettingDescriptor[] {
  return typescript().settings ?? [];
}

describe('the Kotlin server settings (#1209)', () => {
  /**
   * Finds the Kotlin server's descriptor in the catalogue.
   * @returns Returns the descriptor.
   */
  function kotlin(): LanguageServerDescriptor {
    const found: LanguageServerDescriptor | undefined = languageServerCatalogue().find(
      (descriptor: LanguageServerDescriptor): boolean => descriptor.id === 'kotlin',
    );
    if (found === undefined) {
      throw new Error('The catalogue has no Kotlin server');
    }
    return found;
  }

  it('everySetting_isPushedUnderKotlin_asTheServerNeverAsks', () => {
    expect(kotlin().settingsDelivery).toEqual({ pull: false, push: ['kotlin'] });
    for (const setting of kotlin().settings ?? []) {
      expect(setting.section.startsWith('kotlin.')).toBe(true);
    }
  });

  it('pushedSettings_nestAsTheServerReadsThem_withItsOwnDefaults', () => {
    const descriptor: LanguageServerDescriptor = kotlin();
    const values: LspServerSettingValues | undefined = withDeclaredDefaults(descriptor.settings, {
      'kotlin.inlayHints.typeHints': true,
    });

    expect(pushedSettings(descriptor.settingsDelivery, values)).toEqual({
      kotlin: {
        inlayHints: { typeHints: true, parameterHints: false, chainedHints: false },
        completion: { snippets: { enabled: true } },
      },
    });
  });
});

describe('the TypeScript server settings (#1207)', () => {
  it('everySetting_reachesTheServer_pushedOrAtStartUp', () => {
    const pushed: readonly string[] = typescript().settingsDelivery?.push ?? [];
    const startup: string | undefined = typescript().settingsDelivery?.startup?.section;

    for (const setting of settings()) {
      const section: string = setting.section.split('.')[0];
      expect(pushed.includes(section) || section === startup).toBe(true);
    }
  });

  it('aSettingReadAtStartUp_isMarked_andSaysItRestartsTheServer', () => {
    const startup: string | undefined = typescript().settingsDelivery?.startup?.section;

    for (const setting of settings()) {
      const readAtStartUp: boolean = setting.section.startsWith(`${startup}.`);
      expect(setting.startupOnly === true).toBe(readAtStartUp);
      expect(setting.description.includes('restarts')).toBe(readAtStartUp);
    }
  });

  it('aChoice_offersItsOwnDefault', () => {
    for (const setting of settings().filter(
      (candidate: LspServerSettingDescriptor): boolean => candidate.options !== undefined,
    )) {
      expect(setting.options?.map((option): unknown => option.value)).toContain(setting.default);
    }
  });

  it('labels_areUnique_soNoTwoRowsReadTheSame', () => {
    const labels: readonly string[] = settings().map(
      (setting: LspServerSettingDescriptor): string => setting.label,
    );

    expect(new Set(labels).size).toBe(labels.length);
  });

  it('pushedSettings_nestFormatInlayHintsAndCompletionsAsTheServerReadsThem', () => {
    const descriptor: LanguageServerDescriptor = typescript();

    const pushed: Record<string, unknown> | undefined = pushedSettings(
      descriptor.settingsDelivery,
      {
        'typescript.format.semicolons': 'insert',
        'javascript.inlayHints.includeInlayVariableTypeHints': true,
        'completions.completeFunctionCalls': true,
      },
    );

    expect(pushed).toEqual({
      typescript: { format: { semicolons: 'insert' } },
      javascript: { inlayHints: { includeInlayVariableTypeHints: true } },
      completions: { completeFunctionCalls: true },
    });
  });

  it('startupOptions_carryTheGeneratedCodeStyle_inPreferences', () => {
    const descriptor: LanguageServerDescriptor = typescript();
    const values: LspServerSettingValues | undefined = withDeclaredDefaults(settings(), {
      'preferences.quotePreference': 'single',
    });

    expect(startupOptions(descriptor.settingsDelivery, values)).toEqual({
      preferences: {
        includeCompletionsForModuleExports: true,
        importModuleSpecifierPreference: 'shortest',
        quotePreference: 'single',
      },
    });
  });
});
