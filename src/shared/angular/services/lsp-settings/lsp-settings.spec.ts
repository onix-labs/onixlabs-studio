import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { LspChannel, LspSettings as LspSettingsData } from '@shared/api/lsp-channels';
import { LspSettings } from './lsp-settings';

describe('LspSettings', () => {
  let stored: LspSettingsData;
  let setCalls: LspSettingsData[];

  beforeEach(() => {
    stored = {
      disabledServers: ['java'],
      javaPath: null,
      dotnetPath: null,
      clangdPath: null,
      typescriptServerPath: null,
      serverArgs: {},
    };
    setCalls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (LspChannel.GetSettings as string)) {
          return Promise.resolve(stored as T);
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
});
