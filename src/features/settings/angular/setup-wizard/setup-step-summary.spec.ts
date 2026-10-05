import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiAuthStatus, AiConnection, ProviderPage } from '@shared/api/ai-types';
import type { ForgeAuthStatus } from '@shared/api/forge-types';
import type { PluginSummary } from '@shared/api/plugin-channels';
import type { SetupProbeResult } from '@shared/api/setup-channels';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { Forge } from '@shared/angular/services/forge/forge';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { SetupProbes } from '@shared/angular/services/setup-probes/setup-probes';
import { SetupWizard } from '@shared/angular/services/setup-wizard/setup-wizard';
import { SetupStepSummary } from './setup-step-summary';

/**
 * An installed Git plugin that declares a committer identity.
 */
const GIT: PluginSummary = {
  id: 'onixlabs.git',
  name: 'Git',
  description: '',
  state: 'installed',
  version: '0.1.0',
  installedVersion: '0.1.0',
  detail: null,
  origin: null,
  contributions: [
    {
      slot: 'version-control',
      id: 'onixlabs.git',
      displayName: 'Git',
      priority: 100,
      capabilities: ['identity'],
    },
  ],
} as unknown as PluginSummary;

/**
 * An installed C# language server.
 */
const CSHARP: PluginSummary = {
  id: 'onixlabs.roslyn',
  name: 'C# (Roslyn)',
  description: '',
  state: 'installed',
  version: '1.0.0',
  installedVersion: '1.0.0',
  detail: null,
  origin: null,
  contributions: [{ slot: 'language-server', id: 'roslyn', language: 'csharp' }],
} as unknown as PluginSummary;

describe('SetupStepSummary', () => {
  let fixture: ComponentFixture<SetupStepSummary>;
  let host: HTMLElement;
  let results: WritableSignal<readonly SetupProbeResult[]>;
  let connections: WritableSignal<readonly AiConnection[]>;
  let installed: WritableSignal<readonly PluginSummary[]>;
  let forge: ForgeAuthStatus;
  let goTo: ReturnType<typeof vi.fn>;

  /**
   * Renders the summary and lets its reads settle.
   * @returns Returns a promise that resolves once the view has settled.
   */
  async function render(): Promise<void> {
    fixture = TestBed.createComponent(SetupStepSummary);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Finds the row with the given name.
   * @param name The row's name.
   * @returns Returns the row element, or undefined.
   */
  function row(name: string): HTMLElement | undefined {
    return Array.from(host.querySelectorAll<HTMLElement>('.env__item')).find(
      (item: HTMLElement): boolean =>
        item.querySelector('.env__name')?.textContent?.trim() === name,
    );
  }

  beforeEach(async () => {
    localStorage.clear();
    results = signal<readonly SetupProbeResult[]>([
      { id: 'git', status: 'ok', detail: 'git version 2.50.0' },
      { id: 'git-identity', status: 'warn', detail: 'No email configured.' },
      { id: 'node', status: 'ok', detail: 'v24.0.0' },
      { id: 'go', status: 'missing', detail: 'Not found.' },
    ]);
    connections = signal<readonly AiConnection[]>([]);
    installed = signal<readonly PluginSummary[]>([GIT, CSHARP]);
    forge = {
      authenticated: false,
      identity: null,
      hasStoredToken: false,
      source: 'none',
    } as unknown as ForgeAuthStatus;
    goTo = vi.fn();
    await TestBed.configureTestingModule({
      imports: [SetupStepSummary],
      providers: [
        { provide: SetupWizard, useValue: { goTo } },
        {
          provide: SetupProbes,
          useValue: {
            isAvailable: true,
            results,
            busy: signal<boolean>(false),
            refresh: (): Promise<void> => Promise.resolve(),
          },
        },
        {
          provide: AiConnections,
          useValue: {
            connections,
            refreshAllAuth: (): Promise<void> => Promise.resolve(),
            authStatus: (): AiAuthStatus =>
              ({ available: true, detail: 'Signed in.' }) as AiAuthStatus,
          },
        },
        {
          provide: AiProviders,
          useValue: {
            pages: (): readonly ProviderPage[] =>
              [{ id: 'anthropic', kinds: ['anthropic'] }] as unknown as readonly ProviderPage[],
            companyFor: (): string => 'Anthropic',
          },
        },
        { provide: Plugins, useValue: { plugins: installed } },
        {
          provide: Forge,
          useValue: {
            isAvailable: true,
            authStatus: (): Promise<ForgeAuthStatus> => Promise.resolve(forge),
          },
        },
      ],
    }).compileComponents();
  });

  it('render_groupsTheSetupInStepOrder_endingWithTheMachine', async () => {
    await render();

    const titles: readonly string[] = Array.from(host.querySelectorAll('.env__group-title')).map(
      (title: Element): string => title.textContent?.trim() ?? '',
    );
    expect(titles).toEqual([
      'AI providers',
      'Plugins',
      'Version control',
      'Security',
      'Terminal',
      'This machine',
    ]);
  });

  it('render_whenNoProviderIsConfigured_saysSo_andOffersTheWayBack', async () => {
    await render();

    const none: HTMLElement | undefined = row('No provider configured');
    expect(none?.classList.contains('env__item--missing')).toBe(true);
    none?.querySelector<HTMLButtonElement>('.env__change button')?.click();

    expect(goTo).toHaveBeenCalledWith('agent-harness');
  });

  it('render_aConfiguredProvider_linksToItsOwnStep', async () => {
    connections.set([
      { id: 'c1', kind: 'anthropic', label: 'Claude', auth: 'claude-login' } as AiConnection,
    ]);
    await render();

    const provider: HTMLElement | undefined = row('Anthropic (Claude)');
    expect(provider?.classList.contains('env__item--ok')).toBe(true);
    provider?.querySelector<HTMLButtonElement>('.env__change button')?.click();

    expect(goTo).toHaveBeenCalledWith('agent-harness/anthropic');
  });

  it('render_aCategoryWithNothingInstalled_isUnset_notAProblem', async () => {
    await render();

    expect(row('Language Servers')?.querySelector('.env__detail')?.textContent).toContain(
      'C# (Roslyn)',
    );
    const decoders: HTMLElement | undefined = row('Decoders');
    expect(decoders?.querySelector('.env__detail')?.textContent?.trim()).toBe('None installed');
    expect(decoders?.classList.contains('env__item--unset')).toBe(true);
  });

  it('render_anUnsetIdentity_leadsBackToTheSystemsIdentityStep', async () => {
    await render();

    const identity: HTMLElement | undefined = row('Commit identity');
    expect(identity?.classList.contains('env__item--warn')).toBe(true);
    identity?.querySelector<HTMLButtonElement>('.env__change button')?.click();

    expect(goTo).toHaveBeenCalledWith('version-control/onixlabs.git');
  });

  it('render_reportsGitHubWithoutAStepToChangeIt', async () => {
    // GitHub has nothing to set up in the wizard yet, so it is reported rather than given a step.
    await render();

    const github: HTMLElement | undefined = row('GitHub');
    expect(github?.classList.contains('env__item--unset')).toBe(true);
    expect(github?.querySelector('.env__change')).toBeNull();
  });

  it('render_statesSecurityChoicesInTheWordsTheStepOffered', async () => {
    await render();

    expect(row('Permission posture')?.querySelector('.env__detail')?.textContent?.trim()).toBe(
      'Ask every time',
    );
  });

  it('render_keepsToolchainsUnderThisMachine_andVersionControlProbesOutOfIt', async () => {
    await render();

    const machine: Element | undefined = Array.from(host.querySelectorAll('.env__group')).find(
      (group: Element): boolean =>
        group.querySelector('.env__group-title')?.textContent?.trim() === 'This machine',
    );
    const names: readonly string[] = Array.from(machine?.querySelectorAll('.env__name') ?? []).map(
      (name: Element): string => name.textContent?.trim() ?? '',
    );
    expect(names).toEqual(['Node.js', 'Go']);
  });
});
