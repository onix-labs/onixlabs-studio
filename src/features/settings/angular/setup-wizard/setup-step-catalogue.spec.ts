import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginSlot, PluginSummary } from '@shared/api/plugin-channels';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { SetupStepCatalogue } from './setup-step-catalogue';

/**
 * Builds a plugin contributing into one slot, in a given state.
 * @param id The plugin identifier, doubling as its name.
 * @param slot The slot it fills.
 * @param state The install state.
 * @returns Returns the summary.
 */
function plugin(id: string, slot: PluginSlot, state: PluginSummary['state']): PluginSummary {
  return {
    id,
    name: id,
    description: `${id} description`,
    state,
    version: '1.0.0',
    installedVersion: state === 'installed' ? '1.0.0' : null,
    detail: null,
    origin: null,
    contributions: [{ slot, id, displayName: id, priority: 100 }],
  } as unknown as PluginSummary;
}

describe('SetupStepCatalogue', () => {
  let fixture: ComponentFixture<SetupStepCatalogue>;
  let host: HTMLElement;
  let known: WritableSignal<readonly PluginSummary[]>;
  let installWithConsent: ReturnType<typeof vi.fn>;
  let uninstall: ReturnType<typeof vi.fn>;

  /**
   * Renders the step for a slot and settles it.
   * @param slot The slot.
   * @returns Returns a promise that resolves once the view has settled.
   */
  async function render(slot: PluginSlot): Promise<void> {
    fixture = TestBed.createComponent(SetupStepCatalogue);
    fixture.componentRef.setInput('slot', slot);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Reads the plugin names listed.
   * @returns Returns the names in render order.
   */
  function names(): readonly string[] {
    return Array.from(host.querySelectorAll('.catalogue__name')).map(
      (element: Element): string => element.textContent?.trim() ?? '',
    );
  }

  beforeEach(async () => {
    known = signal<readonly PluginSummary[]>([
      plugin('rust-analyzer', 'language-server', 'available'),
      plugin('pyright', 'language-server', 'installed'),
      plugin('docker', 'container-engine', 'available'),
      plugin('podman', 'container-engine', 'unavailable'),
    ]);
    installWithConsent = vi.fn().mockResolvedValue(undefined);
    uninstall = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [SetupStepCatalogue],
      providers: [
        {
          provide: Plugins,
          useValue: {
            plugins: known,
            busy: signal<boolean>(false),
            error: signal<string | null>(null),
            installWithConsent,
            uninstall,
          },
        },
      ],
    }).compileComponents();
  });

  it('render_listsOnlyThePluginsInTheSlot_withWhatIsNotInstalledFirst', async () => {
    // The list exists to be acted on, so the actionable rows lead it; but the installed one stays,
    // because whether it is already there is as much the answer as an Install button.
    await render('language-server');

    expect(names()).toEqual(['rust-analyzer', 'pyright']);
  });

  it('render_offersInstallInTheAccent_andRemoveInRed_asThePluginManagerDoes', async () => {
    await render('language-server');

    const rows: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('.catalogue__item'));
    const install: HTMLElement | null = rows[0].querySelector('app-button');
    expect(install?.textContent?.trim()).toBe('Install');
    expect(install?.classList.contains('button--solid')).toBe(true);
    // The accent is the button's default tone, so it carries no other.
    expect(install?.className).not.toContain('button--tone-');
    const remove: HTMLElement | null = rows[1].querySelector('app-button');
    expect(remove?.textContent?.trim()).toBe('Remove');
    expect(remove?.classList.contains('button--solid')).toBe(true);
    expect(remove?.classList.contains('button--tone-danger')).toBe(true);
  });

  it('remove_whenClicked_uninstallsThePlugin', async () => {
    await render('language-server');

    const rows: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('.catalogue__item'));
    rows[1].querySelector<HTMLButtonElement>('button')?.click();

    // A plugin tried during setup can be taken back out without leaving it.
    expect(uninstall).toHaveBeenCalledWith('pyright');
  });

  it('render_saysWhenAPluginCannotBeInstalledHere_ratherThanOfferingAnInstallThatWillRefuse', async () => {
    await render('container-engine');

    const rows: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('.catalogue__item'));
    expect(rows[1].textContent).toContain('Not available here');
    expect(rows[1].querySelector('button')).toBeNull();
  });

  it('install_whenClicked_installsThroughTheSameConsentThePluginManagerAsks', async () => {
    await render('container-engine');

    host.querySelector<HTMLButtonElement>('.catalogue__item button')?.click();

    expect(installWithConsent).toHaveBeenCalledWith('docker');
  });

  it('render_whenTheSlotHasNoPlugins_saysSo', async () => {
    await render('decoder');

    expect(names()).toEqual([]);
    expect(host.textContent).toContain('No plugins are available');
  });
});
