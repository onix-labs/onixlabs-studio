import { describe, expect, it, vi } from 'vitest';
import type { LspSettings } from '@shared/api/lsp-channels';

// A user-data folder that does not exist, so no installed plugin contributes a server.
vi.mock('electron', () => ({
  app: { getPath: (): string => '/nonexistent/studio-registry-spec', isPackaged: false },
  ipcMain: { handle: (): void => undefined, on: (): void => undefined },
}));

const { LspServerRegistry } = await import('./lsp-server-registry');
const { parsePluginManifest } = await import('@shared/api/plugin-manifest');
const { toLanguageServerDescriptors } = await import('../contributions/plugins/plugin-loader');
const { answerConfiguration } = await import('./lsp-server-settings');
const { default: CURATED } = await import('../contributions/plugins/curated-plugins.json');
type LanguageServerDescriptor = import('./lsp-server-registry').LanguageServerDescriptor;
type LspSettingsChange = import('./lsp-server-registry').LspSettingsChange;
type LspSettingsManager = import('./lsp-settings').LspSettingsManager;

/**
 * Builds a stand-in for the user's language-server settings, which a spec changes by hand.
 * @param serverSettings The user's values for servers' declared settings.
 * @returns Returns the stand-in, and a way to change the values as Settings would.
 */
function userSettings(serverSettings: LspSettings['serverSettings']): {
  readonly manager: LspSettingsManager;
  change(next: LspSettings['serverSettings']): void;
} {
  let current: LspSettings = {
    disabledServers: [],
    javaPath: null,
    dotnetPath: null,
    serverPaths: {},
    serverArgs: {},
    languageServers: {},
    serverSettings,
  };
  const listeners: ((previous: LspSettings, next: LspSettings) => void)[] = [];
  return {
    manager: {
      get: (): LspSettings => current,
      onChange: (listener: (previous: LspSettings, next: LspSettings) => void): void =>
        void listeners.push(listener),
    } as unknown as LspSettingsManager,
    change(next: LspSettings['serverSettings']): void {
      const previous: LspSettings = current;
      current = { ...current, serverSettings: next };
      for (const listener of listeners) {
        listener(previous, current);
      }
    },
  };
}

/**
 * A server shaped like jdtls: never asks, is pushed `java.*`, and given them at start-up — one of
 * which it reads only then.
 */
const JDTLS_LIKE: LanguageServerDescriptor = {
  id: 'jdtls-like',
  displayName: 'jdtls-like',
  languages: ['java'],
  priority: 100,
  settingsDelivery: {
    pull: false,
    push: ['java'],
    startup: { section: 'java', key: 'settings.java' },
  },
  settings: [
    {
      section: 'java.referencesCodeLens.enabled',
      label: 'Reference counts',
      description: 'r',
      default: false,
    },
    {
      section: 'java.import.gradle.enabled',
      label: 'Import Gradle projects',
      description: 'g',
      default: true,
      startupOnly: true,
    },
  ],
  resolve: () => ({
    spec: { command: 'jdtls', args: [], initializationOptions: { bundles: [] } },
    error: null,
  }),
};

describe('LspServerRegistry settings delivery (#1204)', () => {
  it('startsAServer_withItsSettingsInItsInitializationOptions_mergedWithItsOwn', async () => {
    const { manager } = userSettings({ 'jdtls-like': { 'java.referencesCodeLens.enabled': true } });
    const registry: InstanceType<typeof LspServerRegistry> = new LspServerRegistry(
      '/electron',
      manager,
    );
    registry.register(JDTLS_LIKE);

    const resolution: Awaited<ReturnType<typeof registry.resolve>> = await registry.resolve(
      'jdtls-like',
      '/root',
    );

    expect(resolution.spec?.initializationOptions).toEqual({
      bundles: [],
      settings: {
        java: { referencesCodeLens: { enabled: true }, import: { gradle: { enabled: true } } },
      },
    });
  });

  it('pushesAServerItsSettingsShapedUnderItsSection', () => {
    const { manager } = userSettings({});
    const registry: InstanceType<typeof LspServerRegistry> = new LspServerRegistry(
      '/electron',
      manager,
    );
    registry.register(JDTLS_LIKE);

    expect(registry.pushedSettingsOf('jdtls-like')).toEqual({
      java: { referencesCodeLens: { enabled: false }, import: { gradle: { enabled: true } } },
    });
    // Roslyn asks for its settings, so is never pushed them.
    expect(registry.pushedSettingsOf('csharp')).toBeUndefined();
  });

  it('aChange_restartsTheServer_onlyWhenASettingItReadsAtStartUpChanged', () => {
    const settings: ReturnType<typeof userSettings> = userSettings({});
    const registry: InstanceType<typeof LspServerRegistry> = new LspServerRegistry(
      '/electron',
      settings.manager,
    );
    registry.register(JDTLS_LIKE);
    const heard: (readonly LspSettingsChange[])[] = [];
    registry.onConfigurationChange(
      (changes: readonly LspSettingsChange[]): void => void heard.push(changes),
    );

    settings.change({ 'jdtls-like': { 'java.referencesCodeLens.enabled': true } });
    settings.change({
      'jdtls-like': {
        'java.referencesCodeLens.enabled': true,
        'java.import.gradle.enabled': false,
      },
      csharp: { 'projects.dotnet_enable_automatic_restore': false },
    });

    expect(heard).toEqual([
      [{ serverId: 'jdtls-like', restart: false }],
      [
        { serverId: 'jdtls-like', restart: true },
        { serverId: 'csharp', restart: false },
      ],
    ]);
  });

  it('theFirstPartyServers_declareHowTheyTakeTheirSettings', () => {
    const { manager } = userSettings({
      typescript: { 'typescript.referencesCodeLens.enabled': true },
    });
    const registry: InstanceType<typeof LspServerRegistry> = new LspServerRegistry(
      '/electron',
      manager,
    );

    expect(registry.pushedSettingsOf('typescript')).toMatchObject({
      typescript: { referencesCodeLens: { enabled: true } },
      javascript: { referencesCodeLens: { enabled: false } },
    });
    expect(registry.pushedSettingsOf('typescript')).not.toHaveProperty('preferences');
    expect(registry.pushedSettingsOf('java')).toMatchObject({
      // On by default, as jdtls itself has it.
      java: { referencesCodeLens: { enabled: true } },
    });
  });
});

describe('LspServerRegistry: the web servers (#1218, #1219)', () => {
  /**
   * Builds a registry holding the curated HTML, CSS and JSON servers, as an install of
   * `vscode-langservers-extracted` contributes them.
   * @returns Returns the registry, and a way to change the user's values as Settings would.
   */
  function webServers(): {
    readonly registry: InstanceType<typeof LspServerRegistry>;
    readonly settings: ReturnType<typeof userSettings>;
  } {
    const entry: unknown = (CURATED.plugins as readonly { id: string }[]).find(
      (plugin: { id: string }): boolean => plugin.id === 'vscode-langservers-extracted',
    );
    const manifest: ReturnType<typeof parsePluginManifest>['manifest'] =
      parsePluginManifest(entry).manifest;
    const settings: ReturnType<typeof userSettings> = userSettings({});
    const registry: InstanceType<typeof LspServerRegistry> = new LspServerRegistry(
      '/electron',
      settings.manager,
    );
    for (const descriptor of toLanguageServerDescriptors(manifest!)) {
      registry.register(descriptor);
    }
    return { registry, settings };
  }

  it('css_answersEachLanguagesSectionWithAnObject_neverNull', () => {
    // The server reads `settings.lint.validProperties` from the answer, and throws on null.
    const { registry } = webServers();

    expect(
      answerConfiguration(registry.configurationOf('vscode-css-language-server'), [
        { section: 'css' },
        { section: 'scss' },
        { section: 'less' },
      ]),
    ).toEqual([{ validate: true }, { validate: true }, { validate: true }]);
  });

  it('css_aChangeIsPushedForEveryLanguage_asTheServerReplacesWhatItHoldsPerLanguage', () => {
    const { registry, settings } = webServers();
    settings.change({ 'vscode-css-language-server': { 'scss.validate': false } });

    expect(registry.pushedSettingsOf('vscode-css-language-server')).toEqual({
      css: { validate: true },
      scss: { validate: false },
      less: { validate: true },
    });
  });

  it('html_answersTheEmbeddedCssSectionWithAnObject_andLeavesTheScriptSectionsNull', () => {
    // `js/ts` stays null: the server reads `js/ts.implicitProjectConfig.strictNullChecks` from any
    // object it is given, so an object without it would throw.
    const { registry } = webServers();

    expect(
      answerConfiguration(registry.configurationOf('vscode-html-language-server'), [
        { section: 'css' },
        { section: 'html' },
        { section: 'javascript' },
        { section: 'js/ts' },
      ]),
    ).toEqual([{ validate: true }, { validate: { scripts: true } }, null, null]);
  });

  it('json_neverAsks_andIsPushedItsJsonAndHttpSettings_withoutARestart', () => {
    const { registry, settings } = webServers();
    const heard: (readonly LspSettingsChange[])[] = [];
    registry.onConfigurationChange(
      (changes: readonly LspSettingsChange[]): void => void heard.push(changes),
    );

    expect(registry.pullsSettings('vscode-json-language-server')).toBe(false);
    expect(registry.pushedSettingsOf('vscode-json-language-server')).toEqual({
      json: { validate: { enable: true } },
      http: { proxyStrictSSL: true },
    });

    settings.change({ 'vscode-json-language-server': { 'json.validate.enable': false } });

    expect(heard).toEqual([[{ serverId: 'vscode-json-language-server', restart: false }]]);
    expect(registry.pushedSettingsOf('vscode-json-language-server')).toEqual({
      json: { validate: { enable: false } },
      http: { proxyStrictSSL: true },
    });
  });
});
