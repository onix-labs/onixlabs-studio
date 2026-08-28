import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { PluginState, PluginSummary } from '@shared/api/plugin-channels';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { LanguageSupportPrompt } from './language-support-prompt';
import { Plugins } from './plugins';

/**
 * Builds a plugin summary contributing a language server for the given languages.
 * @param id The plugin identifier.
 * @param languages The languages its server serves.
 * @param state The plugin's state.
 * @returns Returns the summary.
 */
function plugin(id: string, languages: readonly string[], state: PluginState): PluginSummary {
  return {
    id,
    name: id,
    description: '',
    state,
    contributions: [{ slot: 'language-server', id, displayName: id, languages, priority: 100 }],
    version: '1.0.0',
    detail: null,
    origin: null,
    installedVersion: null,
  };
}

describe('LanguageSupportPrompt', () => {
  let plugins: WritableSignal<readonly PluginSummary[]>;
  let raised: NotificationRequest[];
  let installed: string[];

  /**
   * Builds the prompt under test with fake plugin and notification services.
   * @returns Returns the prompt.
   */
  function build(): LanguageSupportPrompt {
    TestBed.configureTestingModule({
      providers: [
        LanguageSupportPrompt,
        {
          provide: Plugins,
          useValue: {
            plugins,
            install: (id: string): Promise<void> => {
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
    return TestBed.inject(LanguageSupportPrompt);
  }

  beforeEach(() => {
    raised = [];
    installed = [];
    plugins = signal<readonly PluginSummary[]>([
      plugin('pyright', ['python'], 'available'),
      plugin('ty', ['python'], 'available'),
      plugin('typescript-language-server', ['typescript'], 'installed'),
    ]);
  });

  it('offerFor_uninstalledLanguage_offersTheDefaultPlugin', () => {
    build().offerFor('python');

    expect(raised).toHaveLength(1);
    expect(raised[0]?.title).toContain('Python');
    expect(raised[0]?.actions?.[0]?.label).toBe('Install pyright');
  });

  it('offerFor_offersOnlyOnePluginEvenWhenSeveralProvideTheLanguage', () => {
    build().offerFor('python');

    expect(raised[0]?.actions).toHaveLength(1);
  });

  it('offerFor_actionInstallsTheOfferedPlugin', () => {
    build().offerFor('python');
    raised[0]?.actions?.[0]?.run();

    expect(installed).toEqual(['pyright']);
  });

  it('offerFor_languageAlreadySupported_saysNothing', () => {
    build().offerFor('typescript');

    expect(raised).toEqual([]);
  });

  it('offerFor_languageNoPluginProvides_saysNothing', () => {
    build().offerFor('cobol');

    expect(raised).toEqual([]);
  });

  it('offerFor_repeatedForTheSameLanguage_asksOnce', () => {
    const prompt: LanguageSupportPrompt = build();
    prompt.offerFor('python');
    prompt.offerFor('python');
    prompt.offerFor('python');

    expect(raised).toHaveLength(1);
  });

  it('offerFor_differentLanguages_asksForEach', () => {
    plugins.set([
      plugin('pyright', ['python'], 'available'),
      plugin('rust-analyzer', ['rust'], 'available'),
    ]);
    const prompt: LanguageSupportPrompt = build();
    prompt.offerFor('python');
    prompt.offerFor('rust');

    expect(raised).toHaveLength(2);
  });

  it('offerFor_coalescesPerLanguage', () => {
    build().offerFor('python');

    expect(raised[0]?.key).toBe('language-support:python');
  });

  it('offerFor_pluginMidInstall_doesNotOfferItAgain', () => {
    // A plugin that is busy is neither installed nor available; offering it again would queue a second
    // install on top of the one already running.
    plugins.set([plugin('pyright', ['python'], 'busy')]);
    build().offerFor('python');

    expect(raised).toEqual([]);
  });

  it('offerFor_staysUntilAnswered', () => {
    // A transient toast lasts five seconds; an offer carrying a button the user must reach for cannot
    // expire on a timer, or the action is unclickable in practice.
    build().offerFor('python');

    expect(raised[0]?.sticky).toBe(true);
  });
});
