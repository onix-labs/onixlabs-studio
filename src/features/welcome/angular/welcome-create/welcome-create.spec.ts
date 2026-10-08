import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { PluginSummary } from '@shared/api/plugin-channels';
import { Clone } from '@shared/angular/services/clone/clone';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { WelcomeCreate } from './welcome-create';

/**
 * Builds an installed plugin filling a slot.
 * @param slot The slot.
 * @returns Returns its summary.
 */
function installed(slot: 'version-control' | 'hosting'): PluginSummary {
  return {
    id: `test.${slot}`,
    state: 'installed',
    contributions: [{ slot, id: `test.${slot}` }],
  } as unknown as PluginSummary;
}

describe('WelcomeCreate', () => {
  let fixture: ComponentFixture<WelcomeCreate>;
  let host: HTMLElement;
  let plugins: WritableSignal<readonly PluginSummary[]>;
  let remembered: string | null;
  let picked: string | null;

  beforeEach(async () => {
    plugins = signal<readonly PluginSummary[]>([
      installed('version-control'),
      installed('hosting'),
    ]);
    remembered = '/Users/me/Development';
    picked = '/Users/me/Projects';
    await TestBed.configureTestingModule({
      imports: [WelcomeCreate],
      providers: [
        { provide: Plugins, useValue: { plugins } },
        {
          provide: Clone,
          useValue: {
            parent: (): Promise<string | null> => Promise.resolve(remembered),
            pickParent: (): Promise<string | null> => Promise.resolve(picked),
          },
        },
      ],
    }).compileComponents();
  });

  /**
   * Creates the component and lets its remembered location arrive.
   */
  async function render(): Promise<void> {
    fixture = TestBed.createComponent(WelcomeCreate);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  }

  /**
   * Types a project name.
   * @param text The name.
   */
  async function typeName(text: string): Promise<void> {
    const input: HTMLInputElement = host.querySelector<HTMLInputElement>('#create-name')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  /**
   * Picks a value in one of the form's dropdowns.
   * @param label The dropdown's accessible name.
   * @param value The value.
   */
  async function choose(label: string, value: string): Promise<void> {
    const select: HTMLSelectElement = host.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`,
    )!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  /**
   * Gets the values a dropdown offers, without its placeholder.
   * @param label The dropdown's accessible name.
   * @returns Returns them, in order.
   */
  function offered(label: string): string[] {
    return Array.from(
      host.querySelectorAll<HTMLOptionElement>(`select[aria-label="${label}"] option`),
    )
      .filter((option: HTMLOptionElement): boolean => !option.hidden)
      .map((option: HTMLOptionElement): string => option.value);
  }

  /**
   * Gets the line saying where starting opens the agent.
   * @returns Returns its text.
   */
  function destination(): string {
    return host.querySelector('.create__destination')!.textContent.trim();
  }

  it('location_startsAtTheRememberedFolder', async () => {
    await render();

    expect(host.querySelector('.create__path')!.textContent.trim()).toBe('/Users/me/Development');
  });

  it('browse_changesTheLocation', async () => {
    await render();

    host.querySelector<HTMLButtonElement>('.create__browse')!.click();
    await fixture.whenStable();

    expect(host.querySelector('.create__path')!.textContent.trim()).toBe('/Users/me/Projects');
  });

  it('repository_offersOnlyWhatThePluginsCanMake', async () => {
    await render();
    expect(offered('Repository')).toEqual(['none', 'local', 'public', 'private']);

    plugins.set([installed('version-control')]);
    await fixture.whenStable();
    expect(offered('Repository')).toEqual(['none', 'local']);

    plugins.set([]);
    await fixture.whenStable();
    expect(offered('Repository')).toEqual(['none']);
  });

  it('layout_isAskedOnlyWhenThereIsARepository', async () => {
    await render();
    expect(host.querySelector('select[aria-label="Repository layout"]')).toBeNull();

    await choose('Repository', 'none');
    expect(host.querySelector('select[aria-label="Repository layout"]')).toBeNull();

    await choose('Repository', 'private');
    expect(host.querySelector('select[aria-label="Repository layout"]')).not.toBeNull();
  });

  it('emptyForm_opensTheAgentInItsOwnTab', async () => {
    await render();
    expect(destination()).toContain('own tab');

    host.querySelector<HTMLButtonElement>('.create__starter')!.click();
    await fixture.whenStable();

    expect(host.querySelector('.create__notice')!.textContent).toContain('open an agent tab');
  });

  it('completeForm_opensANewWorkspace_atTheTarget', async () => {
    await render();
    await typeName('todo-app');
    await choose('Repository', 'local');
    expect(destination()).toContain('Finish the details');

    await choose('Repository layout', 'flat');
    expect(destination()).toContain('/Users/me/Development/todo-app');

    host.querySelector<HTMLButtonElement>('.create__start')!.click();
    await fixture.whenStable();

    expect(host.querySelector('.create__notice')!.textContent).toContain(
      'open a new workspace at /Users/me/Development/todo-app',
    );
  });

  it('noRepository_needsNoLayout', async () => {
    await render();
    await typeName('todo-app');
    await choose('Repository', 'none');

    expect(destination()).toContain('Opens a new workspace');
  });

  it('aStarter_namesItsSkill_inThePreview', async () => {
    await render();
    const flutter: HTMLButtonElement = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.create__starter'),
    ).find((row: HTMLButtonElement): boolean => row.textContent.includes('Flutter'))!;

    flutter.click();
    await fixture.whenStable();

    expect(host.querySelector('.create__notice')!.textContent).toContain('Flutter');
  });

  it('anInvalidName_isExplained_andDoesNotCountAsComplete', async () => {
    await render();
    await typeName('my project/');
    await choose('Repository', 'none');

    expect(host.querySelector('.create__error')).not.toBeNull();
    expect(destination()).toContain('Finish the details');
  });

  it('editingTheForm_clearsThePreview', async () => {
    await render();
    host.querySelector<HTMLButtonElement>('.create__start')!.click();
    await fixture.whenStable();

    await typeName('todo');

    expect(host.querySelector('.create__notice')).toBeNull();
  });
});
