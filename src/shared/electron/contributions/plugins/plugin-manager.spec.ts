import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PluginActionResult, PluginSummary } from '@shared/api/plugin-channels';
import { PluginContext, PluginDescriptor } from './plugin-catalogue';
import { PluginManager } from './plugin-manager';
import { PluginStore } from './plugin-store';

/**
 * Builds a descriptor whose detection and installation are scripted by the test.
 * @param id The plugin identifier.
 * @param detected Whether the plugin detects as installed.
 * @returns Returns the descriptor.
 */
function descriptor(id: string, detected: () => boolean): PluginDescriptor {
  return {
    id,
    name: id,
    description: '',
    version: '1.0.0',
    contributions: [
      { slot: 'language-server', id, displayName: id, languages: ['x'], priority: 100 },
    ],
    detect: (): Promise<boolean> => Promise.resolve(detected()),
    install: (): Promise<string | null> => Promise.resolve(`/installed/${id}`),
    uninstall: (): Promise<void> => Promise.resolve(),
  };
}

describe('PluginManager', () => {
  let directory: string;
  let store: PluginStore;
  const context: PluginContext = {} as PluginContext;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'studio-plugins-'));
    store = new PluginStore(directory);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Lists the plugins and returns the one summary.
   * @param manager The manager under test.
   * @returns Returns the summary.
   */
  async function only(manager: PluginManager): Promise<PluginSummary> {
    const summaries: readonly PluginSummary[] = await manager.list();
    expect(summaries).toHaveLength(1);
    return summaries[0];
  }

  it('list_detectedPlugin_isInstalled', async () => {
    const manager: PluginManager = new PluginManager(
      [descriptor('demo', (): boolean => true)],
      context,
      store,
    );

    expect((await only(manager)).state).toBe('installed');
  });

  it('list_undetectedPluginWithoutARecord_isAvailable', async () => {
    const manager: PluginManager = new PluginManager(
      [descriptor('demo', (): boolean => false)],
      context,
      store,
    );

    expect((await only(manager)).state).toBe('available');
  });

  it('list_recordedButUndetected_isAvailableAndTheRecordIsForgotten', async () => {
    // The split-brain case: the store said installed (its recorded path still existed) while the
    // descriptor — the predicate the registry resolves against — said not. Reporting "installed" here
    // hid the Install button that would have repaired it. Detection is the only truth; a stale record
    // is dropped so the plugin is offered again.
    store.add({ id: 'demo', version: '0.9.0', installedPath: directory });
    const manager: PluginManager = new PluginManager(
      [descriptor('demo', (): boolean => false)],
      context,
      store,
    );

    const summary: PluginSummary = await only(manager);

    expect(summary.state).toBe('available');
    expect(store.get('demo')).toBeNull();
    expect(summary.installedVersion).toBeNull();
  });

  it('install_recordsTheInstallAndReportsInstalled', async () => {
    let present: boolean = false;
    const manager: PluginManager = new PluginManager(
      [descriptor('demo', (): boolean => present)],
      context,
      store,
    );

    const result: PluginActionResult = await manager.install('demo');
    present = true;

    expect(result).toEqual({ success: true, state: 'installed', error: null });
    expect(store.get('demo')?.installedPath).toBe('/installed/demo');
    expect((await only(manager)).state).toBe('installed');
  });

  it('uninstall_forgetsTheRecordAndReportsAvailable', async () => {
    let present: boolean = true;
    const manager: PluginManager = new PluginManager(
      [descriptor('demo', (): boolean => present)],
      context,
      store,
    );
    await manager.install('demo');

    const result: PluginActionResult = await manager.uninstall('demo');
    present = false;

    expect(result).toEqual({ success: true, state: 'available', error: null });
    expect(store.get('demo')).toBeNull();
    expect((await only(manager)).state).toBe('available');
  });

  it('install_unknownPlugin_isRejected', async () => {
    const manager: PluginManager = new PluginManager([], context, store);

    expect((await manager.install('nope')).success).toBe(false);
  });
});
