import type { LspServerSettingDescriptor } from '@shared/api/lsp-channels';
import type { LanguageServerDescriptor } from './language-server-descriptor';
import { languageServerCatalogue } from './language-server-catalogue';
import { GOPLS_SETTINGS } from './gopls-settings';
import {
  answerConfiguration,
  readOnlyAtStartup,
  withDeclaredDefaults,
} from './lsp-server-settings';

/**
 * Finds gopls's descriptor in the catalogue.
 * @returns Returns the descriptor.
 */
function gopls(): LanguageServerDescriptor {
  const found: LanguageServerDescriptor | undefined = languageServerCatalogue().find(
    (descriptor: LanguageServerDescriptor): boolean => descriptor.id === 'go',
  );
  if (found === undefined) {
    throw new Error('The catalogue has no Go server');
  }
  return found;
}

describe('the gopls settings (#1211)', () => {
  it('theGoServer_declaresThem', () => {
    expect(gopls().settings).toBe(GOPLS_SETTINGS);
  });

  it('everySetting_isUnderTheGoplsSection_whichTheServerAsksFor', () => {
    for (const setting of GOPLS_SETTINGS) {
      expect(setting.section.startsWith('gopls.')).toBe(true);
    }
  });

  it('noSetting_restartsTheServer_asItAsksAgainAfterEveryChange', () => {
    for (const setting of GOPLS_SETTINGS) {
      expect(readOnlyAtStartup(gopls().settingsDelivery, setting)).toBe(false);
    }
  });

  it('aChoice_offersItsOwnDefault', () => {
    for (const setting of GOPLS_SETTINGS.filter(
      (candidate: LspServerSettingDescriptor): boolean => candidate.options !== undefined,
    )) {
      expect(setting.options?.map((option): unknown => option.value)).toContain(setting.default);
    }
  });

  it('labels_areUnique_soNoTwoRowsReadTheSame', () => {
    const labels: readonly string[] = GOPLS_SETTINGS.map(
      (setting: LspServerSettingDescriptor): string => setting.label,
    );

    expect(new Set(labels).size).toBe(labels.length);
  });

  it('theWholeSection_isAnsweredNested_withSemanticTokensOn', () => {
    const [answer] = answerConfiguration(withDeclaredDefaults(GOPLS_SETTINGS, undefined), [
      { section: 'gopls' },
    ]) as [Record<string, unknown>];

    expect(answer['semanticTokens']).toBe(true);
    expect(answer['hints']).toEqual({
      parameterNames: false,
      assignVariableTypes: false,
      constantValues: false,
      compositeLiteralFields: false,
      rangeVariableTypes: false,
      compositeLiteralTypes: false,
      functionTypeParameters: false,
    });
    expect(answer['codelenses']).toEqual({
      generate: true,
      tidy: true,
      upgrade_dependency: true,
      vendor: true,
      run_govulncheck: false,
    });
    expect(answer['vulncheck']).toBe('Off');
  });

  it('aUsersValue_replacesTheDefault_inTheNestedAnswer', () => {
    const [answer] = answerConfiguration(
      withDeclaredDefaults(GOPLS_SETTINGS, { 'gopls.hints.parameterNames': true }),
      [{ section: 'gopls' }],
    ) as [{ hints: Record<string, unknown> }];

    expect(answer.hints['parameterNames']).toBe(true);
  });
});
