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
   * Reads the names shown in the step's rows.
   * @returns Returns the names in render order.
   */
  function names(): readonly string[] {
    return Array.from(host.querySelectorAll('.ai__name')).map(
      (element: Element): string => element.textContent?.trim() ?? '',
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

  it('render_whenNothingIsConfigured_offersTheSignInMethods', async () => {
    known.set([harness('installed')]);
    await render();

    expect(button('Subscription')).toBeDefined();
    expect(button('API Key')).toBeDefined();
    expect(button('Check this provider')).toBeUndefined();
  });

  it('choose_whenAMethodIsClicked_createsAConfigurationNamingThePluginAndMakesItActive', async () => {
    known.set([harness('installed')]);
    await render();

    button('Subscription')?.click();
    fixture.detectChanges();

    const settings: Settings = TestBed.inject(Settings);
    const active: AiConnection | undefined = settings.aiActiveConnection();
    expect(active?.kind).toBe('anthropic');
    expect(active?.auth).toBe('claude-login');
    // 🔑 The configuration names the harness from the moment it exists, which is what makes it
    // runnable; a wizard that left this for the user to repair in Settings would not be onboarding.
    expect(active?.harnessId).toBe('test.claude-harness');
    // And the step has moved on to the credential and the check.
    expect(button('Check this provider')).toBeDefined();
    expect(button('Subscription')).toBeUndefined();
  });

  it('change_whenClicked_goesBackToChoosingWithTheExistingConfigurationOnOffer', async () => {
    known.set([harness('installed')]);
    await render();
    button('API Key')?.click();
    fixture.detectChanges();

    button('Change')?.click();
    fixture.detectChanges();

    // The configuration just made is offered back, beside the sign-in methods, rather than
    // silently orphaned in Settings.
    expect(names()).toEqual(['Anthropic (Anthropic API)', 'How you sign in']);
    expect(button('Use')).toBeDefined();
    expect(button('Subscription')).toBeDefined();
  });

  it('use_whenClicked_returnsToVerifyingThatConfiguration', async () => {
    known.set([harness('installed')]);
    await render();
    button('API Key')?.click();
    fixture.detectChanges();
    button('Change')?.click();
    fixture.detectChanges();

    button('Use')?.click();
    fixture.detectChanges();

    expect(button('Check this provider')).toBeDefined();
    expect(button('Use')).toBeUndefined();
  });

  it('verify_whenTheProviderDoesNotAnswer_saysSoAgainstThatConfiguration', async () => {
    known.set([harness('installed')]);
    await render();
    button('API Key')?.click();
    fixture.detectChanges();
    const connections: AiConnections = TestBed.inject(AiConnections);
    vi.spyOn(connections, 'refreshAuth').mockResolvedValue(undefined);
    vi.spyOn(connections, 'authStatus').mockReturnValue({
      source: 'none',
      available: false,
      hasStoredKey: false,
      detail: 'No credential.',
    });

    await (fixture.componentInstance as unknown as { verify(): Promise<void> }).verify();
    fixture.detectChanges();

    expect(host.querySelector('.ai__verdict')?.textContent).toContain('did not answer');
    expect(host.querySelector('.ai__verdict--bad')).not.toBeNull();
  });

  it('verify_whenTheProviderAnswers_saysTheAgentIsReady', async () => {
    known.set([harness('installed')]);
    await render();
    button('API Key')?.click();
    fixture.detectChanges();
    const connections: AiConnections = TestBed.inject(AiConnections);
    vi.spyOn(connections, 'refreshAuth').mockResolvedValue(undefined);
    vi.spyOn(connections, 'authStatus').mockReturnValue({
      source: 'api-key',
      available: true,
      hasStoredKey: true,
      detail: 'Using the stored key.',
    });

    await (fixture.componentInstance as unknown as { verify(): Promise<void> }).verify();
    fixture.detectChanges();

    expect(host.querySelector('.ai__verdict')?.textContent).toContain('ready to use');
    expect(host.querySelector('.ai__verdict--bad')).toBeNull();
  });
});
