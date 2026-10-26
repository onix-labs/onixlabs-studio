import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { PluginState, PluginSummary } from '@shared/api/plugin-channels';
import { DatabaseEnginePrompt } from './database-engine-prompt';
import { Plugins } from './plugins';

/**
 * Builds a plugin summary contributing a database engine.
 * @param id The plugin identifier.
 * @param state The plugin's state.
 * @returns Returns the summary.
 */
function plugin(id: string, state: PluginState): PluginSummary {
  return {
    id,
    name: id,
    description: '',
    state,
    contributions: [{ slot: 'database-engine', id, displayName: id, priority: 100 }],
    version: '1.0.0',
    detail: null,
    origin: null,
    installedVersion: null,
  };
}

/**
 * Builds a plugin summary contributing something that is not a database engine, so the prompt has
 * something to correctly ignore.
 * @param id The plugin identifier.
 * @param state The plugin's state.
 * @returns Returns the summary.
 */
function other(id: string, state: PluginState): PluginSummary {
  return {
    ...plugin(id, state),
    contributions: [{ slot: 'container-engine', id, displayName: id, priority: 100 }],
  };
}

describe('DatabaseEnginePrompt', () => {
  let plugins: WritableSignal<readonly PluginSummary[]>;
  let installed: string[];

  /**
   * Builds the prompt under test with a fake plugin service.
   * @returns Returns the prompt.
   */
  function build(): DatabaseEnginePrompt {
    TestBed.configureTestingModule({
      providers: [
        DatabaseEnginePrompt,
        {
          provide: Plugins,
          useValue: {
            plugins,
            installWithConsent: (id: string): Promise<'installed'> => {
              installed.push(id);
              return Promise.resolve<'installed'>('installed');
            },
          },
        },
      ],
    });
    return TestBed.inject(DatabaseEnginePrompt);
  }

  beforeEach(() => {
    installed = [];
    plugins = signal<readonly PluginSummary[]>([
      plugin('postgres-engine', 'available'),
      plugin('sqlite-engine', 'available'),
      other('docker-engine', 'installed'),
    ]);
  });

  it('candidates_listsOnlyUninstalledDatabaseEnginePlugins', () => {
    const prompt: DatabaseEnginePrompt = build();

    expect(prompt.candidates().map((entry: PluginSummary): string => entry.id)).toEqual([
      'postgres-engine',
      'sqlite-engine',
    ]);
  });

  it('candidates_withAnEngineAlreadyInstalled_isEmpty', () => {
    // Once one engine is installed the gap is filled; the empty state is not met again.
    plugins.set([plugin('postgres-engine', 'installed'), plugin('sqlite-engine', 'available')]);

    expect(build().candidates()).toEqual([]);
  });

  it('candidates_withNoDatabaseEnginePluginAtAll_isEmpty', () => {
    plugins.set([other('docker-engine', 'available')]);

    expect(build().candidates()).toEqual([]);
  });

  it('installedKey_withNothingInstalled_isEmpty', () => {
    expect(build().installedKey()).toBe('');
  });

  it('installedKey_namesTheInstalledEnginesSorted', () => {
    plugins.set([
      plugin('sqlite-engine', 'installed'),
      plugin('postgres-engine', 'installed'),
      plugin('mysql-engine', 'available'),
      other('docker-engine', 'installed'),
    ]);

    expect(build().installedKey()).toBe('postgres-engine\nsqlite-engine');
  });

  it('installedKey_changesWhenAnEngineIsInstalled', () => {
    const prompt: DatabaseEnginePrompt = build();
    const before: string = prompt.installedKey();

    plugins.set([plugin('postgres-engine', 'installed'), plugin('sqlite-engine', 'available')]);

    expect(prompt.installedKey()).not.toBe(before);
    expect(prompt.installedKey()).toBe('postgres-engine');
  });

  it('installedKey_ignoresAChangeThatIsNotAnEngine', () => {
    const prompt: DatabaseEnginePrompt = build();
    const before: string = prompt.installedKey();

    plugins.set([...plugins(), other('podman-engine', 'installed')]);

    expect(prompt.installedKey()).toBe(before);
  });

  it('install_installsThroughConsent', async () => {
    const prompt: DatabaseEnginePrompt = build();

    await prompt.install(plugin('postgres-engine', 'available'));

    expect(installed).toEqual(['postgres-engine']);
  });
});
