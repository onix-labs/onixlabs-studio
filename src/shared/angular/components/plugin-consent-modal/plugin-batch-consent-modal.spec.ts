import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PluginSummary } from '@shared/api/plugin-channels';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { PluginBatchConsentModal } from './plugin-batch-consent-modal';

/**
 * Builds a plugin summary for an installed plugin with an update.
 * @param name The plugin's name.
 * @param from The installed version.
 * @param to The version on offer.
 * @returns Returns the summary.
 */
function update(name: string, from: string, to: string): PluginSummary {
  return {
    id: name.toLowerCase(),
    name,
    description: 'Test plugin.',
    state: 'installed',
    contributions: [],
    version: to,
    detail: null,
    origin: null,
    installedVersion: from,
  };
}

describe('PluginBatchConsentModal', () => {
  let fixture: ComponentFixture<PluginBatchConsentModal>;
  let windows: FakeModalWindows;
  let accepted: number;
  let declined: number;

  beforeEach(async (): Promise<void> => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [PluginBatchConsentModal],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(PluginBatchConsentModal);
    accepted = 0;
    declined = 0;
    fixture.componentInstance.accepted.subscribe((): number => (accepted += 1));
    fixture.componentInstance.declined.subscribe((): number => (declined += 1));
  });

  /**
   * Asks about the plugins, then returns the content host of the window the modal opened.
   * @param plugins The plugins, or null when nothing is being asked.
   * @returns Returns the content host, or null when no window was opened.
   */
  async function present(plugins: readonly PluginSummary[] | null): Promise<HTMLElement | null> {
    fixture.componentRef.setInput('plugins', plugins);
    fixture.detectChanges();
    await fixture.whenStable();
    return windows.contentHost;
  }

  /**
   * Finds a button in the window by its label.
   * @param host The window's content host.
   * @param label The button's label.
   * @returns Returns the button, or undefined.
   */
  function button(host: HTMLElement, label: string): HTMLButtonElement | undefined {
    return [...host.querySelectorAll('button')].find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    );
  }

  it('opensNothing_whenNothingIsAsked', async () => {
    expect(await present(null)).toBeNull();
  });

  it('titlesTheCount_withoutQuotes', async () => {
    const host: HTMLElement | null = await present([
      update('Git', '0.8.0', '0.9.0'),
      update('GitHub', '0.6.0', '0.7.0'),
    ]);

    expect(host?.querySelector('.consent__title')?.textContent?.trim()).toBe('Update 2 plugins?');
  });

  it('listsEachPlugin_withItsVersionBeforeAndAfter', async () => {
    const host: HTMLElement | null = await present([
      update('Git', '0.8.0', '0.9.0'),
      update('GitHub', '0.6.0', '0.7.0'),
    ]);

    const rows: string[] = [...(host?.querySelectorAll('.consent__item') ?? [])].map(
      (row: Element): string =>
        `${row.querySelector('.consent__name')?.textContent?.trim()} | ${row
          .querySelector('.consent__versions')
          ?.textContent?.trim()}`,
    );
    expect(rows).toEqual(['Git | 0.8.0 → 0.9.0', 'GitHub | 0.6.0 → 0.7.0']);
  });

  it('saysTheSameTermsAsEachPluginsOwnWindow', async () => {
    const host: HTMLElement | null = await present([update('Git', '0.8.0', '0.9.0')]);

    const body: string = host?.querySelector('.consent__body')?.textContent ?? '';
    expect(body).toContain('third-party software');
    expect(body).toContain('does not review what the code does');
    expect(host?.querySelector('.consent__title')?.textContent?.trim()).toBe('Update 1 plugin?');
  });

  it('updateAll_accepts_andCancel_declines', async () => {
    const host: HTMLElement | null = await present([update('Git', '0.8.0', '0.9.0')]);

    button(host!, 'Update All')?.click();
    button(host!, 'Cancel')?.click();

    expect(accepted).toBe(1);
    expect(declined).toBe(1);
  });
});
