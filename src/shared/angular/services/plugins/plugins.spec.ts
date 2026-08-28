import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { PluginActionResult, PluginChannel, PluginSummary } from '@shared/api/plugin-channels';
import { PluginConsent } from './plugin-consent';
import { Plugins } from './plugins';

/**
 * Builds a plugin summary for the tests.
 * @param id The plugin identifier.
 * @param state The plugin's state.
 * @returns Returns the summary.
 */
function plugin(id: string, state: PluginSummary['state']): PluginSummary {
  return {
    id,
    name: id,
    description: '',
    state,
    contributions: [
      { slot: 'language-server', id, displayName: id, languages: ['python'], priority: 100 },
    ],
    version: '1.0.0',
    detail: null,
    origin: null,
    installedVersion: null,
  };
}

describe('Plugins', () => {
  let listed: readonly PluginSummary[];
  let result: PluginActionResult;
  let invoked: { channel: string; id: string | undefined }[];
  let changedListener: ((...args: unknown[]) => void) | null;

  beforeEach(() => {
    listed = [plugin('rust-analyzer', 'available')];
    result = { success: true, state: 'installed', error: null };
    invoked = [];
    changedListener = null;
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        invoked.push({ channel, id: args[0] as string | undefined });
        if (channel === (PluginChannel.List as string)) {
          return Promise.resolve(listed as T);
        }
        return Promise.resolve(result as T);
      },
      send: (): void => undefined,
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        if (channel === (PluginChannel.Changed as string)) {
          changedListener = listener;
        }
        return (): void => undefined;
      },
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('refresh_loadsThePluginList', async () => {
    const service: Plugins = TestBed.inject(Plugins);
    await service.refresh();

    expect(service.plugins().map((p: PluginSummary): string => p.id)).toEqual(['rust-analyzer']);
  });

  it('install_namesThePluginOnTheInstallChannel', async () => {
    const service: Plugins = TestBed.inject(Plugins);
    await service.install('rust-analyzer');

    expect(invoked).toContainEqual({ channel: PluginChannel.Install, id: 'rust-analyzer' });
  });

  it('uninstall_namesThePluginOnTheUninstallChannel', async () => {
    const service: Plugins = TestBed.inject(Plugins);
    await service.uninstall('rust-analyzer');

    expect(invoked).toContainEqual({ channel: PluginChannel.Uninstall, id: 'rust-analyzer' });
  });

  it('installWithConsent_accepted_installs', async () => {
    const service: Plugins = TestBed.inject(Plugins);
    await service.refresh();
    const consent: PluginConsent = TestBed.inject(PluginConsent);

    const done: Promise<void> = service.installWithConsent('rust-analyzer');
    expect(consent.pending()?.id).toBe('rust-analyzer');
    consent.accept();
    await done;

    expect(invoked).toContainEqual({ channel: PluginChannel.Install, id: 'rust-analyzer' });
  });

  it('installWithConsent_declined_installsNothing', async () => {
    // Consent that any entry point could skip would not be consent; the answer gates the install.
    const service: Plugins = TestBed.inject(Plugins);
    await service.refresh();
    const consent: PluginConsent = TestBed.inject(PluginConsent);

    const done: Promise<void> = service.installWithConsent('rust-analyzer');
    consent.decline();
    await done;

    expect(
      invoked.some((call): boolean => call.channel === (PluginChannel.Install as string)),
    ).toBe(false);
  });

  it('installWithConsent_unknownPlugin_asksNothingAndInstallsNothing', async () => {
    const service: Plugins = TestBed.inject(Plugins);
    await service.refresh();

    await service.installWithConsent('nope');

    expect(TestBed.inject(PluginConsent).pending()).toBeNull();
    expect(
      invoked.some((call): boolean => call.channel === (PluginChannel.Install as string)),
    ).toBe(false);
  });

  it('install_failure_surfacesTheReason', async () => {
    result = { success: false, state: 'available', error: 'Go toolchain not found.' };
    const service: Plugins = TestBed.inject(Plugins);
    await service.install('gopls');

    expect(service.error()).toBe('Go toolchain not found.');
  });

  it('install_success_clearsAPreviousError', async () => {
    result = { success: false, state: 'available', error: 'nope' };
    const service: Plugins = TestBed.inject(Plugins);
    await service.install('gopls');
    result = { success: true, state: 'installed', error: null };
    await service.install('gopls');

    expect(service.error()).toBeNull();
  });

  it('changedEvent_updatesTheListWithoutARefresh', async () => {
    const service: Plugins = TestBed.inject(Plugins);
    await service.refresh();
    changedListener?.([plugin('rust-analyzer', 'installed')]);

    expect(service.plugins()[0]?.state).toBe('installed');
  });

  it('busy_isFalseOnceAnActionSettles', async () => {
    const service: Plugins = TestBed.inject(Plugins);
    await service.install('rust-analyzer');

    expect(service.busy()).toBe(false);
  });

  it('withoutABridge_degradesToAnEmptyList', async () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const service: Plugins = TestBed.inject(Plugins);
    await service.refresh();

    expect(service.plugins()).toEqual([]);
  });
});
