import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { PluginState, PluginSummary } from '@shared/api/plugin-channels';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { ContainerEnginePrompt } from './container-engine-prompt';
import { Plugins } from './plugins';

/**
 * Builds a plugin summary contributing a container engine.
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
    contributions: [{ slot: 'container-engine', id, displayName: id, priority: 100 }],
    version: '1.0.0',
    detail: null,
    origin: null,
    installedVersion: null,
  };
}

/**
 * Builds a plugin summary contributing something that is not an engine, so the prompt has something to
 * correctly ignore.
 * @param id The plugin identifier.
 * @param state The plugin's state.
 * @returns Returns the summary.
 */
function other(id: string, state: PluginState): PluginSummary {
  return {
    ...plugin(id, state),
    contributions: [
      { slot: 'language-server', id, displayName: id, languages: ['python'], priority: 100 },
    ],
  };
}

describe('ContainerEnginePrompt', () => {
  let plugins: WritableSignal<readonly PluginSummary[]>;
  let raised: NotificationRequest[];
  let installed: string[];

  /**
   * Builds the prompt under test with fake plugin and notification services.
   * @returns Returns the prompt.
   */
  function build(): ContainerEnginePrompt {
    TestBed.configureTestingModule({
      providers: [
        ContainerEnginePrompt,
        {
          provide: Plugins,
          useValue: {
            plugins,
            installWithConsent: (id: string): Promise<void> => {
              installed.push(id);
              return Promise.resolve();
            },
          },
        },
        {
          provide: Notifications,
          useValue: {
            notify: (request: NotificationRequest): void => {
              raised.push(request);
            },
          },
        },
      ],
    });
    return TestBed.inject(ContainerEnginePrompt);
  }

  beforeEach(() => {
    raised = [];
    installed = [];
    plugins = signal<readonly PluginSummary[]>([
      plugin('docker-engine', 'available'),
      plugin('podman-engine', 'available'),
      other('ty', 'installed'),
    ]);
  });

  it('offer_withNoEngineInstalled_offersTheDefaultEngine', () => {
    build().offer();

    expect(raised).toHaveLength(1);
    expect(raised[0]?.title).toBe('No container engine is installed');
    expect(raised[0]?.actions?.[0]?.label).toBe('Install docker-engine');
  });

  it('offer_offersOnlyOneEngineEvenWhenSeveralAreAvailable', () => {
    // Offering a choice would be asking the user to compare two things they have not installed.
    build().offer();

    expect(raised[0]?.actions).toHaveLength(1);
  });

  it('offer_actionInstallsThroughConsent', () => {
    build().offer();
    raised[0]?.actions?.[0]?.run();

    expect(installed).toEqual(['docker-engine']);
  });

  it('offer_isRaisedOncePerSession', () => {
    // A container engine is keyed by nothing, so "once per key" is simply once — opening the tab
    // twice must not ask twice.
    const prompt: ContainerEnginePrompt = build();
    prompt.offer();
    prompt.offer();

    expect(raised).toHaveLength(1);
  });

  it('offer_withAnEngineAlreadyInstalled_saysNothing', () => {
    plugins.set([plugin('docker-engine', 'installed')]);
    build().offer();

    expect(raised).toEqual([]);
  });

  it('offer_withNoEnginePluginAtAll_saysNothing', () => {
    // Nothing to offer is not the same as something to offer: an offer with no candidate would be a
    // notification the user can do nothing about.
    plugins.set([other('ty', 'available')]);
    build().offer();

    expect(raised).toEqual([]);
  });

  it('isInstalled_reflectsWhetherAnInstalledPluginContributesAnEngine', () => {
    const prompt: ContainerEnginePrompt = build();
    expect(prompt.isInstalled()).toBe(false);

    plugins.set([plugin('docker-engine', 'installed')]);
    expect(prompt.isInstalled()).toBe(true);
  });

  it('candidates_listsOnlyUninstalledEnginePlugins', () => {
    const prompt: ContainerEnginePrompt = build();

    expect(prompt.candidates().map((entry: PluginSummary): string => entry.id)).toEqual([
      'docker-engine',
      'podman-engine',
    ]);
  });

  it('installFirstCandidate_installsTheEngineTheEmptyStateNames', async () => {
    await build().installFirstCandidate();

    expect(installed).toEqual(['docker-engine']);
  });

  it('installFirstCandidate_withNothingToInstall_doesNothing', async () => {
    plugins.set([other('ty', 'available')]);
    await build().installFirstCandidate();

    expect(installed).toEqual([]);
  });
});
