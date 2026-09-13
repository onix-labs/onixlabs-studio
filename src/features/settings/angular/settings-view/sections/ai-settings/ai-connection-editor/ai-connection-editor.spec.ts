import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import type { AiConnection } from '@shared/api/ai-types';
import type { ContributedAiProvider, PluginSummary } from '@shared/api/plugin-channels';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiConnectionEditor } from './ai-connection-editor';

/**
 * Builds a connection to edit.
 * @param patch Fields overriding the defaults.
 * @returns Returns the connection.
 */
function connection(patch: Partial<AiConnection> = {}): AiConnection {
  return {
    id: 'conn-1',
    kind: 'anthropic',
    label: 'Claude',
    auth: 'claude-login',
    models: [],
    defaultModelId: null,
    ...patch,
  } as AiConnection;
}

/**
 * Builds an installed plugin contributing one agent harness.
 * @param id The harness (and plugin) id.
 * @param displayName The name shown in the picker.
 * @param state The plugin's state on this machine.
 * @param providers The provider pages the harness contributes.
 * @returns Returns the plugin summary.
 */
function harnessPlugin(
  id: string,
  displayName: string,
  state: 'installed' | 'available' = 'installed',
  providers: readonly ContributedAiProvider[] = [],
): PluginSummary {
  return {
    id,
    name: displayName,
    description: '',
    state,
    version: '0.1.0',
    contributions: [{ slot: 'agent-harness', id, displayName, priority: 100, providers }],
  } as unknown as PluginSummary;
}

describe('AiConnectionEditor', () => {
  let fixture: ComponentFixture<AiConnectionEditor>;
  let plugins: WritableSignal<readonly PluginSummary[]>;
  let update: ReturnType<typeof vi.fn>;

  /**
   * Mounts the editor for a connection.
   * @param value The connection to edit.
   */
  function mount(value: AiConnection): void {
    fixture = TestBed.createComponent(AiConnectionEditor);
    fixture.componentRef.setInput('connection', value);
    fixture.detectChanges();
  }

  /**
   * Reads the Runs-through row, or null when it is not shown.
   * @returns Returns the row, or null.
   */
  function row(): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('.conn-editor__harness');
  }

  /**
   * Reads what the Runs-through row says.
   * @returns Returns the row's text.
   */
  function reading(): string {
    return (
      (fixture.nativeElement as HTMLElement)
        .querySelector('.conn-editor__harness-name')
        ?.textContent?.trim() ?? ''
    );
  }

  /**
   * Reads the repair button, or null when none is offered.
   * @returns Returns the button, or null.
   */
  function repairButton(): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('.conn-editor__harness button');
  }

  beforeEach(() => {
    plugins = signal<readonly PluginSummary[]>([]);
    update = vi.fn();
    TestBed.configureTestingModule({
      imports: [AiConnectionEditor],
      providers: [
        { provide: Plugins, useValue: { plugins } },
        {
          provide: AiConnections,
          useValue: {
            update,
            isAvailable: true,
            authStatus: (): { state: string; detail: string } => ({ state: 'ready', detail: '' }),
          },
        },
      ],
    });
  });

  it('withTheNamedHarnessInstalled_showsNoRowAtAll', () => {
    // ⛔ A fact, not a choice, and not shown while it is right. The sign-in button that created the
    // configuration belonged to the plugin that runs it; a row saying so on every working
    // configuration is noise, and the picker this replaced could only hand a configuration to a plugin
    // that does not speak its sign-in method.
    plugins.set([
      harnessPlugin('onixlabs.claude-harness', 'Claude'),
      harnessPlugin('onixlabs.codex-harness', 'Codex'),
    ]);
    mount(connection({ harnessId: 'onixlabs.claude-harness' }));

    expect(row()).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('withNothingNamedAndNothingInstalled_saysItCannotRun', () => {
    mount(connection());

    expect(reading()).toContain('Not set');
    expect(repairButton()).toBeNull();
  });

  it('withTheNamedHarnessUninstalled_saysSoWithoutRewritingTheChoice', () => {
    // The plugin that ran it is gone, so it cannot run, and saying so beats naming a plugin that is not
    // there. ⚠️ The stored id is deliberately NOT cleared — reinstalling restores the choice, and
    // silently rewriting a user's configuration because a plugin is temporarily absent would lose it.
    plugins.set([harnessPlugin('onixlabs.ai-sdk-harness', 'AI SDK')]);
    mount(connection({ harnessId: 'onixlabs.claude-harness' }));

    expect(reading()).toContain('no longer installed');
    expect(update).not.toHaveBeenCalled();
  });

  it('withNothingNamed_offersThePluginWhosePageHasTheSignInMethod', () => {
    // 🔑 The one repair that is not a free choice: the same answer creating the configuration would
    // give today, for a configuration that predates plugins naming themselves (#703).
    plugins.set([
      harnessPlugin('onixlabs.claude-harness', 'Claude', 'installed', [
        {
          kind: 'anthropic',
          company: 'Anthropic',
          authMethods: [
            { auth: 'claude-login', buttonLabel: 'Sign in', defaultDisplayName: 'Claude' },
          ],
        },
      ]),
      harnessPlugin('onixlabs.codex-harness', 'Codex', 'installed', [
        {
          kind: 'openai',
          company: 'OpenAI',
          authMethods: [
            { auth: 'codex-login', buttonLabel: 'Sign in', defaultDisplayName: 'Codex' },
          ],
        },
      ]),
    ]);
    mount(connection());

    expect(reading()).toContain('Not set');
    expect(repairButton()?.textContent?.trim()).toBe('Use Claude');
    repairButton()!.click();

    expect(update).toHaveBeenCalledWith('conn-1', { harnessId: 'onixlabs.claude-harness' });
  });

  it('withAHarnessMerelyAvailable_offersNoRepairThroughIt', () => {
    // Listed in the catalogue is not installed. Pointing a configuration at something that cannot run
    // it would be the picker's mistake again.
    plugins.set([
      harnessPlugin('onixlabs.claude-harness', 'Claude', 'available', [
        {
          kind: 'anthropic',
          company: 'Anthropic',
          authMethods: [
            { auth: 'claude-login', buttonLabel: 'Sign in', defaultDisplayName: 'Claude' },
          ],
        },
      ]),
    ]);
    mount(connection());

    expect(repairButton()).toBeNull();
  });
});
