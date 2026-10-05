import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { PluginState, PluginSummary } from '@shared/api/plugin-channels';
import { DetectedRepository } from '@shared/api/source-control-channels';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { Plugins } from './plugins';
import { VersionControlPrompt } from './version-control-prompt';

/**
 * Builds a plugin summary contributing a version-control system.
 * @param id The plugin and contribution identifier.
 * @param state The plugin's state.
 * @returns Returns the summary.
 */
function plugin(id: string, state: PluginState): PluginSummary {
  return {
    id,
    name: id === 'onixlabs.git' ? 'Git' : id,
    description: '',
    state,
    contributions: [{ slot: 'version-control', id, displayName: id, priority: 100 }],
    version: '0.1.0',
    detail: null,
    origin: null,
    installedVersion: null,
  };
}

/**
 * A Git repository that no installed plugin can read.
 */
const GIT_REPOSITORY: DetectedRepository = {
  pluginId: 'onixlabs.git',
  displayName: 'Git',
  installed: false,
};

describe('VersionControlPrompt', () => {
  let plugins: WritableSignal<readonly PluginSummary[]>;
  let raised: NotificationRequest[];
  let installed: string[];

  /**
   * Builds the prompt under test with fake plugin and notification services.
   * @returns Returns the prompt.
   */
  function build(): VersionControlPrompt {
    TestBed.configureTestingModule({
      providers: [
        VersionControlPrompt,
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
    return TestBed.inject(VersionControlPrompt);
  }

  beforeEach(() => {
    plugins = signal<readonly PluginSummary[]>([
      plugin('other.svn', 'available'),
      plugin('onixlabs.git', 'available'),
    ]);
    raised = [];
    installed = [];
  });

  it('offer_namesTheRepositoryAndOffersThePluginItNeeds_once', () => {
    const prompt: VersionControlPrompt = build();

    prompt.offer(GIT_REPOSITORY);
    prompt.offer(GIT_REPOSITORY);

    expect(raised).toHaveLength(1);
    expect(raised[0].title).toBe('This folder is a Git repository');
    raised[0].actions?.[0].run();
    // The plugin the repository needs, not merely the first the catalogue lists.
    expect(installed).toEqual(['onixlabs.git']);
  });

  it('needed_isTheRepository_untilAPluginIsInstalled', () => {
    const prompt: VersionControlPrompt = build();
    prompt.offer(GIT_REPOSITORY);
    expect(prompt.needed()).toEqual(GIT_REPOSITORY);

    plugins.set([plugin('onixlabs.git', 'installed')]);

    expect(prompt.isInstalled()).toBe(true);
    expect(prompt.needed()).toBeNull();
  });

  it('offer_whenAPluginIsAlreadyInstalled_saysNothing', () => {
    plugins.set([plugin('onixlabs.git', 'installed')]);
    const prompt: VersionControlPrompt = build();

    prompt.offer(GIT_REPOSITORY);

    expect(raised).toEqual([]);
  });

  it('install_fromTheEmptyState_installsThePluginTheRepositoryNeeds', async () => {
    const prompt: VersionControlPrompt = build();
    prompt.offer(GIT_REPOSITORY);

    await prompt.install();

    expect(installed).toEqual(['onixlabs.git']);
  });

  it('clear_forgetsTheRepository', () => {
    const prompt: VersionControlPrompt = build();
    prompt.offer(GIT_REPOSITORY);

    prompt.clear();

    expect(prompt.needed()).toBeNull();
  });
});
