import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiConnection } from '@shared/api/ai-types';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Settings } from '@shared/angular/services/settings/settings';
import { SetupStepAiProvider } from './setup-step-ai-provider';

/**
 * Builds a harness plugin contributing an Anthropic page with two sign-in methods, in a given state.
 *
 * ⛔ There is no built-in provider to fall back on (#653): the step has nothing to offer until a
 * plugin is installed, so every case here starts by deciding whether one is.
 * @param state The plugin's install state.
 * @returns Returns the plugin summary.
 */
function harness(state: 'available' | 'installed' | 'busy'): PluginSummary {
  return {
    id: 'test.claude-harness',
    name: 'Claude',
    description: 'Runs the agent through Claude.',
    state,
    version: '1.0.0',
    installedVersion: state === 'installed' ? '1.0.0' : null,
    detail: null,
    origin: null,
    contributions: [
      {
        slot: 'agent-harness',
        id: 'test.claude-harness',
        displayName: 'Claude',
        priority: 100,
        providers: [
          {
            kind: 'anthropic',
            company: 'Anthropic',
            description: 'Anthropic models.',
            authMethods: [
              { auth: 'claude-login', buttonLabel: 'Subscription', defaultDisplayName: 'Claude' },
              { auth: 'api-key', buttonLabel: 'API Key', defaultDisplayName: 'Anthropic API' },
            ],
          },
        ],
      },
    ],
  } as unknown as PluginSummary;
}

describe('SetupStepAiProvider', () => {
  let fixture: ComponentFixture<SetupStepAiProvider>;
  let host: HTMLElement;
  let known: WritableSignal<readonly PluginSummary[]>;
  let installWithConsent: ReturnType<typeof vi.fn>;

  /**
   * Finds the rendered button with the given label.
   * @param label The button's label.
   * @returns Returns the button, or undefined when no button carries the label.
   */
  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    );
  }

  /**
   * Renders the step and settles it.
   * @returns Returns a promise that resolves once the view has settled.
   */
  async function render(): Promise<void> {
    fixture = TestBed.createComponent(SetupStepAiProvider);
    fixture.componentRef.setInput('pageId', 'anthropic');
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    localStorage.clear();
    known = signal<readonly PluginSummary[]>([harness('available')]);
    installWithConsent = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [SetupStepAiProvider],
      providers: [
        {
          provide: Plugins,
          useValue: {
            plugins: known,
            busy: signal<boolean>(false),
            error: signal<string | null>(null),
            installWithConsent,
          },
        },
      ],
    }).compileComponents();
  });

  it('render_whenThePluginBehindThePageIsGone_saysSoRatherThanOfferingNothing', async () => {
    // The step is a leaf beneath an installed plugin; if that plugin goes while the step is showing,
    // an empty panel would be indistinguishable from a control that failed to load.
    await render();

    expect(host.textContent).toContain('no longer installed');
    expect(button('Subscription')).toBeUndefined();
  });

  it('render_showsTheSettingsPagesConfigurations_withEverySignInMethod', async () => {
    known.set([harness('installed')]);
    await render();

    // The settings page's own list, not a wizard version of it.
    expect(host.querySelector('app-ai-provider-configurations')).not.toBeNull();
    expect(button('Subscription')).toBeDefined();
    expect(button('API Key')).toBeDefined();
  });

  it('add_keepsEverySignInMethodOnOffer_andOpensTheNewConfiguration', async () => {
    known.set([harness('installed')]);
    await render();

    button('Subscription')?.click();
    fixture.detectChanges();

    // A provider with two ways in can be given both: using one must not take the other away.
    expect(button('Subscription')).toBeDefined();
    expect(button('API Key')).toBeDefined();
    expect(host.querySelectorAll('app-ai-connection-editor').length).toBe(1);
  });

  it('add_whenNothingIsActive_makesTheConfigurationNamingThePluginTheActiveOne', async () => {
    known.set([harness('installed')]);
    await render();

    button('Subscription')?.click();
    fixture.detectChanges();

    const active: AiConnection | undefined = TestBed.inject(Settings).aiActiveConnection();
    expect(active?.kind).toBe('anthropic');
    expect(active?.auth).toBe('claude-login');
    // 🔑 The configuration names the harness from the moment it exists, which is what makes it
    // runnable; a wizard that left this for the user to repair in Settings would not be onboarding.
    expect(active?.harnessId).toBe('test.claude-harness');
  });

  it('add_whenSomethingIsAlreadyActive_leavesTheUsersChoiceAlone', async () => {
    known.set([harness('installed')]);
    await render();
    button('Subscription')?.click();
    fixture.detectChanges();
    const first: string = TestBed.inject(Settings).aiActiveConnectionId();

    button('API Key')?.click();
    fixture.detectChanges();

    expect(TestBed.inject(AiConnections).connectionsForKinds(['anthropic']).length).toBe(2);
    expect(TestBed.inject(Settings).aiActiveConnectionId()).toBe(first);
  });
});
