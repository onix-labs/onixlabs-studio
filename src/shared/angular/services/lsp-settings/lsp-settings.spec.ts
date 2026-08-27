import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import {
  LspChannel,
  LspServerSummary,
  LspSettings as LspSettingsData,
} from '@shared/api/lsp-channels';
import { PluginChannel, PluginSummary } from '@shared/api/plugin-channels';
import { LspSettings } from './lsp-settings';

/**
 * The registered servers the fake main process publishes: Python is served by two implementations, so
 * it is a slot the user chooses for, while C# is served by one and needs no choice.
 */
const CATALOGUE: readonly LspServerSummary[] = [
  { id: 'pyright', displayName: 'Pyright', languages: ['python'], priority: 100 },
  { id: 'ty', displayName: 'ty (Astral)', languages: ['python'], priority: 50 },
  { id: 'csharp', displayName: 'Roslyn', languages: ['csharp'], priority: 100 },
];

/**
 * Builds a plugin summary contributing one language server, so a test can say which servers are
 * *installed* independently of which are registered.
 * @param id The plugin and server identifier.
 * @param languages The languages the server serves.
 * @param installed Whether the plugin is installed.
 * @returns Returns the summary.
 */
function plugin(id: string, languages: readonly string[], installed: boolean): PluginSummary {
  return {
    id,
    name: id,
    description: '',
    state: installed ? 'installed' : 'available',
    contributions: [{ slot: 'language-server', id, displayName: id, languages, priority: 100 }],
    version: '1.0.0',
    detail: null,
    origin: null,
  };
}

describe('LspSettings', () => {
  let stored: LspSettingsData;
  let setCalls: LspSettingsData[];
  let catalogue: readonly LspServerSummary[];
  let plugins: readonly PluginSummary[];

  beforeEach(() => {
    stored = {
      disabledServers: ['java'],
      javaPath: null,
      dotnetPath: null,
      clangdPath: null,
      typescriptServerPath: null,
      serverArgs: {},
      languageServers: {},
    };
    catalogue = CATALOGUE;
    // Everything in the catalogue is installed unless a test says otherwise.
    plugins = [
      plugin('pyright', ['python'], true),
      plugin('ty', ['python'], true),
      plugin('csharp', ['csharp'], true),
    ];
    setCalls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (LspChannel.GetSettings as string)) {
          return Promise.resolve(stored as T);
        }
        if (channel === (LspChannel.GetCatalogue as string)) {
          return Promise.resolve(catalogue as T);
        }
        if (channel === (PluginChannel.List as string)) {
          return Promise.resolve(plugins as T);
        }
        if (channel === (LspChannel.SetSettings as string)) {
          const settings: LspSettingsData = args[0] as LspSettingsData;
          setCalls.push(settings);
          stored = settings;
          return Promise.resolve(settings as T);
        }
        return Promise.resolve(null as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('refresh_loadsDisabledServers', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();

    expect(service.isDisabled('java')).toBe(true);
    expect(service.isDisabled('typescript')).toBe(false);
  });

  it('setServerEnabled_false_disablesTheServer', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();
    await service.setServerEnabled('typescript', false);

    expect(setCalls.at(-1)?.disabledServers).toContain('typescript');
    expect(service.isDisabled('typescript')).toBe(true);
  });

  it('setServerEnabled_true_enablesTheServer', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();
    await service.setServerEnabled('java', true);

    expect(service.isDisabled('java')).toBe(false);
  });

  it('setJavaPath_blank_clearsTheOverride', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();
    await service.setJavaPath('   ');

    expect(setCalls.at(-1)?.javaPath).toBeNull();
  });

  it('setJavaPath_trimsAndStoresThePath', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();
    await service.setJavaPath('  /opt/java/bin/java  ');

    expect(setCalls.at(-1)?.javaPath).toBe('/opt/java/bin/java');
  });

  it('setDotnetPath_trimsAndStoresThePath', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();
    await service.setDotnetPath('  /usr/local/share/dotnet/dotnet  ');

    expect(setCalls.at(-1)?.dotnetPath).toBe('/usr/local/share/dotnet/dotnet');
  });

  it('setClangdPath_trimsAndStoresThePath', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();
    await service.setClangdPath('  /usr/bin/clangd  ');

    expect(setCalls.at(-1)?.clangdPath).toBe('/usr/bin/clangd');
  });

  it('setTypescriptServerPath_blank_clearsTheOverride', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();
    await service.setTypescriptServerPath('  ');

    expect(setCalls.at(-1)?.typescriptServerPath).toBeNull();
  });

  it('setTypescriptServerPath_trimsAndStoresThePath', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();
    await service.setTypescriptServerPath('  /srv/tsls/lib/cli.mjs  ');

    expect(setCalls.at(-1)?.typescriptServerPath).toBe('/srv/tsls/lib/cli.mjs');
  });

  it('setServerArgs_splitsOnWhitespaceAndStores', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();
    await service.setServerArgs('typescript', '  --log-level   4 ');

    expect(setCalls.at(-1)?.serverArgs['typescript']).toEqual(['--log-level', '4']);
    expect(service.serverArgsText('typescript')).toBe('--log-level 4');
  });

  it('setServerArgs_blank_clearsTheOverride', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.refresh();
    await service.setServerArgs('typescript', '--log-level 4');
    await service.setServerArgs('typescript', '   ');

    expect(setCalls.at(-1)?.serverArgs['typescript']).toBeUndefined();
    expect(service.serverArgsText('typescript')).toBe('');
  });

  it('serverForLanguage_noChoice_picksTheHighestPriorityServer', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;
    await service.refresh();

    expect(service.serverForLanguage('python')).toBe('pyright');
  });

  it('serverForLanguage_chosen_picksTheUsersServer', async () => {
    stored = { ...stored, languageServers: { python: 'ty' } };
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;
    await service.refresh();

    expect(service.serverForLanguage('python')).toBe('ty');
  });

  it('serverForLanguage_unregisteredChoice_fallsBackToTheDefault', async () => {
    stored = { ...stored, languageServers: { python: 'basilisk' } };
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;
    await service.refresh();

    expect(service.serverForLanguage('python')).toBe('pyright');
  });

  it('serverForLanguage_unservedLanguage_resolvesToNull', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;
    await service.refresh();

    expect(service.serverForLanguage('cobol')).toBeNull();
  });

  it('serversForLanguage_reportsEveryImplementationOfferedForTheSlot', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;

    expect(service.serversForLanguage('python').map((s: LspServerSummary): string => s.id)).toEqual(
      ['pyright', 'ty'],
    );
    expect(service.serversForLanguage('csharp').map((s: LspServerSummary): string => s.id)).toEqual(
      ['csharp'],
    );
  });

  it('setServerForLanguage_persistsTheChoiceAndTakesEffect', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;
    await service.refresh();
    await service.setServerForLanguage('python', 'ty');

    expect(setCalls.at(-1)?.languageServers).toEqual({ python: 'ty' });
    expect(service.serverForLanguage('python')).toBe('ty');
  });

  it('setServerForLanguage_null_clearsTheChoiceAndRestoresTheDefault', async () => {
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;
    await service.refresh();
    await service.setServerForLanguage('python', 'ty');
    await service.setServerForLanguage('python', null);

    expect(setCalls.at(-1)?.languageServers).toEqual({});
    expect(service.serverForLanguage('python')).toBe('pyright');
  });

  it('serverForLanguage_contributedServer_isSelectableWithoutCodeChange', async () => {
    // The north star: a server the registry never knew about is offered and chosen purely because it
    // appears in the catalogue the main process publishes.
    catalogue = [
      ...CATALOGUE,
      { id: 'contributed', displayName: 'Contributed', languages: ['python'], priority: 10 },
    ];
    plugins = [...plugins, plugin('contributed', ['python'], true)];
    stored = { ...stored, languageServers: { python: 'contributed' } };
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;
    await service.refresh();

    expect(service.serverForLanguage('python')).toBe('contributed');
    expect(service.serversForLanguage('python')).toHaveLength(3);
  });

  it('serverForLanguage_uninstalledPlugin_isNotOfferedForTheSlot', async () => {
    // The join between the Plugin Manager and the slot: ty is registered but its plugin is not
    // installed, so Python has exactly one implementation and ty can never be chosen.
    plugins = [
      plugin('pyright', ['python'], true),
      plugin('ty', ['python'], false),
      plugin('csharp', ['csharp'], true),
    ];
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;
    await service.refresh();

    expect(service.serversForLanguage('python').map((s: LspServerSummary): string => s.id)).toEqual(
      ['pyright'],
    );
    expect(service.serverForLanguage('python')).toBe('pyright');
  });

  it('serverForLanguage_choiceOfAnUninstalledServer_fallsBackToWhatIsInstalled', async () => {
    // Uninstalling the plugin behind a chosen server must not strand the language.
    plugins = [
      plugin('pyright', ['python'], true),
      plugin('ty', ['python'], false),
      plugin('csharp', ['csharp'], true),
    ];
    stored = { ...stored, languageServers: { python: 'ty' } };
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;
    await service.refresh();

    expect(service.serverForLanguage('python')).toBe('pyright');
  });

  it('serverForLanguage_noInstalledPluginServesTheLanguage_resolvesToNull', async () => {
    plugins = [plugin('csharp', ['csharp'], true)];
    const service: LspSettings = TestBed.inject(LspSettings);
    await service.ready;
    await service.refresh();

    expect(service.serverForLanguage('python')).toBeNull();
  });
});
