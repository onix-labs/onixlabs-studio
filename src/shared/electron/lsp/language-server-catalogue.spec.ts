import type { LspServerSettingDescriptor } from '@shared/api/lsp-channels';
import type { LanguageServerDescriptor } from './language-server-descriptor';
import { jdtlsLaunchArgs, languageServerCatalogue } from './language-server-catalogue';
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

describe('the TypeScript server diagnostics (#1207)', () => {
  it('isAskedToCheckWholeProjects_asItPushesOpenFilesOnly', () => {
    expect(typescript().projectDiagnostics).toBe('tsserver');
  });

  it('noOtherServer_isAsked', () => {
    const asked: readonly string[] = languageServerCatalogue()
      .filter(
        (descriptor: LanguageServerDescriptor): boolean =>
          descriptor.projectDiagnostics !== undefined,
      )
      .map((descriptor: LanguageServerDescriptor): string => descriptor.id);

    expect(asked).toEqual(['typescript']);
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

describe('jdtlsLaunchArgs (#1208)', () => {
  const install: { launcherJar: string; configDir: string } = {
    launcherJar: '/servers/jdtls/1.58.0/plugins/org.eclipse.equinox.launcher_1.7.0.jar',
    configDir: '/servers/jdtls/1.58.0/config_mac',
  };

  it('theInstallsConfigurationArea_isOnlyRead_asTheSharedOne', () => {
    const args: string[] = jdtlsLaunchArgs(install, '/data/area', '/data/workspace');

    expect(args).toContain('-Dosgi.sharedConfiguration.area=/servers/jdtls/1.58.0/config_mac');
    expect(args).toContain('-Dosgi.sharedConfiguration.area.readOnly=true');
    expect(args).toContain('-Dosgi.configuration.cascaded=true');
    expect(args[args.indexOf('-configuration') + 1]).toBe('/data/area');
  });

  it('theLauncherAndData_comeLast_afterTheJvmArguments', () => {
    const args: string[] = jdtlsLaunchArgs(install, '/data/area', '/data/workspace');

    expect(args.slice(-6)).toEqual([
      '-jar',
      install.launcherJar,
      '-configuration',
      '/data/area',
      '-data',
      '/data/workspace',
    ]);
    expect(args.indexOf('-Dosgi.checkConfiguration=true')).toBeLessThan(args.indexOf('-jar'));
  });
});
