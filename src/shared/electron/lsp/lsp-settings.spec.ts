import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LspSettings } from '@shared/api/lsp-channels';

/**
 * A handler the manager registered on the IPC bus.
 */
type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

let userData: string = '';
const handlers: Map<string, IpcHandler> = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  app: { getPath: (): string => userData },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler): void => void handlers.set(channel, handler),
  },
}));

const { LspChannel } = await import('@shared/api/lsp-channels');
const { LspSettingsManager } = await import('./lsp-settings');

const DEFAULTS: LspSettings = {
  disabledServers: [],
  javaPath: null,
  dotnetPath: null,
  serverPaths: {},
  serverArgs: {},
  languageServers: {},
  serverSettings: {},
};

describe('LspSettingsManager', () => {
  let store: string = '';

  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'studio-lsp-settings-'));
    store = path.join(userData, 'lsp-settings.json');
    handlers.clear();
  });

  afterEach(() => {
    chmodSync(userData, 0o700);
    rmSync(userData, { recursive: true, force: true });
  });

  /**
   * Registers a manager on the current store.
   * @returns Returns the manager.
   */
  function registered(): InstanceType<typeof LspSettingsManager> {
    const manager: InstanceType<typeof LspSettingsManager> = new LspSettingsManager();
    manager.register();
    return manager;
  }

  /**
   * Stores candidate settings the way the renderer does.
   * @param value The candidate.
   * @returns Returns the settings now stored.
   */
  function set(value: unknown): LspSettings {
    return handlers.get(LspChannel.SetSettings)?.({}, value) as LspSettings;
  }

  it('startsFromTheDefaults_whenNothingIsStored', () => {
    expect(registered().get()).toEqual(DEFAULTS);
    expect(handlers.get(LspChannel.GetSettings)?.({})).toEqual(DEFAULTS);
  });

  it.each<[string, string]>([
    ['truncatedJson', '{"disabledServers":['],
    ['anEmptyFile', ''],
    ['theWrongShape', '[1,2,3]'],
    ['aMalformedField', '{"disabledServers":"csharp"}'],
  ])('startsFromTheDefaults_whenTheStoreHolds_%s', (_name: string, content: string) => {
    writeFileSync(store, content);

    expect(registered().get()).toEqual(DEFAULTS);
  });

  it('restoresWhatItStored_acrossARestart', () => {
    registered();
    const value: LspSettings = {
      disabledServers: ['rust'],
      javaPath: '/opt/java',
      dotnetPath: '/opt/dotnet',
      serverPaths: { go: '/opt/gopls' },
      serverArgs: { go: ['-remote=auto'] },
      languageServers: { python: 'ty' },
      serverSettings: {},
    };

    set(value);

    expect(registered().get()).toEqual(value);
  });

  it('keepsTheStorePrivateToTheUser', () => {
    registered();

    set(DEFAULTS);

    expect(statSync(store).mode & 0o077).toBe(0);
  });

  it('dropsEmptyEntries_andTreatsEmptyPathsAsCleared', () => {
    registered();

    const stored: LspSettings = set({
      disabledServers: [],
      javaPath: '',
      serverArgs: { go: [] },
      languageServers: { python: '' },
    });

    expect(stored).toEqual(DEFAULTS);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['aString', 'settings'],
    ['noDisabledServers', {}],
    ['aNonStringDisabledServer', { disabledServers: [1] }],
    ['aNonStringJavaPath', { disabledServers: [], javaPath: 3 }],
    ['aNonStringDotnetPath', { disabledServers: [], dotnetPath: {} }],
    ['serverPathsOfTheWrongType', { disabledServers: [], serverPaths: 'x' }],
    ['serverArgsOfTheWrongType', { disabledServers: [], serverArgs: 'x' }],
    ['serverArgsThatAreNotLists', { disabledServers: [], serverArgs: { go: 'x' } }],
    ['serverArgsThatAreNotStrings', { disabledServers: [], serverArgs: { go: [1] } }],
    ['languageServersOfTheWrongType', { disabledServers: [], languageServers: 4 }],
    ['aNonStringLanguageServer', { disabledServers: [], languageServers: { go: 1 } }],
    ['serverSettingsOfTheWrongType', { disabledServers: [], serverSettings: 4 }],
  ])('refuses_%s_andKeepsWhatItHad', (_name: string, value: unknown) => {
    const manager: InstanceType<typeof LspSettingsManager> = registered();
    set({ disabledServers: ['rust'] });
    let told: number = 0;
    manager.onChange((): void => {
      told += 1;
    });

    const stored: LspSettings = set(value);

    expect(stored.disabledServers).toEqual(['rust']);
    expect(told).toBe(0);
    expect((JSON.parse(readFileSync(store, 'utf8')) as LspSettings).disabledServers).toEqual([
      'rust',
    ]);
  });

  it('tellsItsListeners_theSettingsBeforeAndAfter', () => {
    const manager: InstanceType<typeof LspSettingsManager> = registered();
    const seen: string[][][] = [];
    manager.onChange((previous: LspSettings, next: LspSettings): void => {
      seen.push([[...previous.disabledServers], [...next.disabledServers]]);
    });

    set({ disabledServers: ['rust'] });

    expect(seen).toEqual([[[], ['rust']]]);
  });

  it.skipIf(process.platform === 'win32')(
    'aStoreThatCannotBeWritten_stillAppliesTheChangeForThisSession',
    () => {
      registered();
      chmodSync(userData, 0o500);

      const stored: LspSettings = set({ disabledServers: ['rust'] });

      expect(stored.disabledServers).toEqual(['rust']);
      expect(existsSync(store)).toBe(false);
    },
  );
});
