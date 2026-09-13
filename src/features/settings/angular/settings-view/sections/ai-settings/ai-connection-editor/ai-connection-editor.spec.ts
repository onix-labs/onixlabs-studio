import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import type { AiConnection } from '@shared/api/ai-types';
import type { PluginSummary } from '@shared/api/plugin-channels';
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
 * @returns Returns the plugin summary.
 */
function harnessPlugin(
  id: string,
  displayName: string,
  state: 'installed' | 'available' = 'installed',
): PluginSummary {
  return {
    id,
    name: displayName,
    description: '',
    state,
    version: '0.1.0',
    contributions: [{ slot: 'agent-harness', id, displayName, priority: 100 }],
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
   * Reads the harness picker, or null when the row is not shown.
   * @returns Returns the dropdown element, or null.
   */
  function picker(): HTMLSelectElement | null {
    // Scoped to the harness row: the editor renders other dropdowns (the Claude CLI setting-control),
    // so a bare `app-dropdown` query would find one of those and report a picker that is not there.
    return (fixture.nativeElement as HTMLElement).querySelector(
      '.conn-editor__harness app-dropdown select',
    );
  }

  /**
   * Chooses a harness through the control, as a user does.
   * @param value The option value to select.
   */
  function choose(value: string): void {
    const select: HTMLSelectElement = picker()!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
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

  it('withNoHarnessInstalled_doesNotOfferTheChoiceAtAll', () => {
    // ⛔ Install, then choose. A dropdown holding only "Built-in" is not a choice, and offering the
    // slot before anything can fill it inverts the order the Plugin Manager exists to enforce.
    mount(connection());

    expect(picker()).toBeNull();
  });

  it('withAHarnessMerelyAvailable_stillDoesNotOfferIt', () => {
    // Listed in the catalogue is not installed. Offering an uninstalled harness would let a user
    // point a connection at something that cannot run it.
    plugins.set([harnessPlugin('onixlabs.ai-sdk-harness', 'AI SDK', 'available')]);
    mount(connection());

    expect(picker()).toBeNull();
  });

  it('withNothingChosen_offersAPlaceholderAndTheInstalledHarnesses', () => {
    // ⛔ The first option used to be **Built-in**, meaning the provider compiled into Studio. Core ships
    // none (#653), so it named something that could never run — and it was the pre-selected value on
    // every connection, which is how a plugin could install cleanly and still do nothing (#697).
    plugins.set([harnessPlugin('onixlabs.ai-sdk-harness', 'AI SDK (out of process)')]);
    mount(connection());

    const labels: readonly string[] = Array.from(picker()!.querySelectorAll('option')).map(
      (option: Element): string => option.textContent?.trim() ?? '',
    );
    expect(labels).toEqual(['Not set — choose a plugin', 'AI SDK (out of process)']);
  });

  it('withAHarnessChosen_offersNoWayBackToAnUnrunnableState', () => {
    plugins.set([harnessPlugin('onixlabs.ai-sdk-harness', 'AI SDK')]);
    mount(connection({ harnessId: 'onixlabs.ai-sdk-harness' }));

    const labels: readonly string[] = Array.from(picker()!.querySelectorAll('option')).map(
      (option: Element): string => option.textContent?.trim() ?? '',
    );
    expect(labels).toEqual(['AI SDK']);
  });

  it('choosingAHarness_namesItOnTheConnection', () => {
    // 🔑 The whole point of the picker: `harnessId` is what makes an installed harness reachable. It
    // existed in the type, the registry and the specs long before anything wrote it, so every
    // connection failed `serves()` and no plugin could ever run a turn.
    plugins.set([harnessPlugin('onixlabs.ai-sdk-harness', 'AI SDK')]);
    mount(connection());

    choose('onixlabs.ai-sdk-harness');

    expect(update).toHaveBeenCalledWith('conn-1', { harnessId: 'onixlabs.ai-sdk-harness' });
  });

  it('withTheNamedHarnessUninstalled_readsAsNotSetWithoutRewritingTheChoice', () => {
    // The plugin that ran it is gone, so it cannot run, and saying "not set" beats naming a plugin that
    // is not there. ⚠️ The stored id is deliberately NOT cleared — reinstalling restores the choice, and
    // silently rewriting a user's configuration because a plugin is temporarily absent would lose it.
    plugins.set([harnessPlugin('onixlabs.ai-sdk-harness', 'AI SDK')]);
    mount(connection({ harnessId: 'onixlabs.claude-harness' }));

    expect(picker()!.value).toBe('');

    expect(update).not.toHaveBeenCalled();
  });
});
