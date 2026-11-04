import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PluginSummary } from '@shared/api/plugin-channels';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { PluginConsentModal } from './plugin-consent-modal';

/**
 * Builds a plugin summary for a new install.
 * @param overrides Fields to replace.
 * @returns Returns the summary.
 */
function summary(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: 'dockerfile-language-server',
    name: 'Dockerfile Language Server',
    description: 'Dockerfile support.',
    state: 'available',
    contributions: [],
    version: '0.15.0',
    detail: null,
    origin: { hosts: ['registry.npmjs.org', 'github.com'], packageCount: 11 },
    installedVersion: null,
    ...overrides,
  };
}

describe('PluginConsentModal', () => {
  let fixture: ComponentFixture<PluginConsentModal>;
  let windows: FakeModalWindows;
  let accepted: number;
  let declined: number;

  beforeEach(async (): Promise<void> => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [PluginConsentModal],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(PluginConsentModal);
    accepted = 0;
    declined = 0;
    fixture.componentInstance.accepted.subscribe((): number => (accepted += 1));
    fixture.componentInstance.declined.subscribe((): number => (declined += 1));
  });

  /**
   * Asks about the plugin, then returns the content host of the window the modal opened.
   * @param plugin The plugin, or null when nothing is being asked.
   * @returns Returns the content host, or null when no window was opened.
   */
  async function present(plugin: PluginSummary | null): Promise<HTMLElement | null> {
    fixture.componentRef.setInput('plugin', plugin);
    fixture.detectChanges();
    await fixture.whenStable();
    return windows.contentHost;
  }

  /**
   * Reads the dialog's two actions, in the order they are drawn.
   * @param host The dialog's content host.
   * @returns Returns the action hosts.
   */
  function actions(host: HTMLElement | null): HTMLElement[] {
    return Array.from(host?.querySelectorAll<HTMLElement>('app-button') ?? []);
  }

  /**
   * Reads the trimmed text of each element matching a selector.
   * @param host The dialog's content host.
   * @param selector The selector.
   * @returns Returns the text of each match, in document order.
   */
  function textsOf(host: HTMLElement | null, selector: string): string[] {
    return Array.from(host?.querySelectorAll<HTMLElement>(selector) ?? []).map(
      (element: HTMLElement): string => (element.textContent ?? '').trim(),
    );
  }

  it('render_whenNothingIsAsked_opensNoWindow', async (): Promise<void> => {
    const host: HTMLElement | null = await present(null);

    expect(host).toBeNull();
    expect(windows.requests).toEqual([]);
  });

  it('newInstall_saysInstall_inTheButtonAndTheTitle', async (): Promise<void> => {
    const host: HTMLElement | null = await present(summary());

    expect(textsOf(host, '.consent__title')).toEqual(['Install Dockerfile Language Server?']);
    expect(windows.requests[0]?.title).toBe('Install Dockerfile Language Server');
    expect(actions(host)[0].textContent?.trim()).toBe('Install');
    expect(actions(host)[0].classList.contains('button--solid')).toBe(true);
  });

  it('update_saysUpdate_inTheButtonAndTheTitle', async (): Promise<void> => {
    const host: HTMLElement | null = await present(summary({ installedVersion: '0.14.0' }));

    expect(textsOf(host, '.consent__title')).toEqual(['Update Dockerfile Language Server?']);
    expect(windows.requests[0]?.title).toBe('Update Dockerfile Language Server');
    expect(actions(host)[0].textContent?.trim()).toBe('Update');
    expect(actions(host)[0].classList.contains('button--solid')).toBe(true);
  });

  it('cancel_isBorderless', async (): Promise<void> => {
    const host: HTMLElement | null = await present(summary());

    const cancel: HTMLElement = actions(host)[1];
    expect(cancel.textContent?.trim()).toBe('Cancel');
    expect(cancel.classList.contains('button--none')).toBe(true);
  });

  it('facts_renderAfterTheParagraphs_andBeforeTheActions', async (): Promise<void> => {
    const host: HTMLElement | null = await present(summary());

    const order: string[] = Array.from(host?.querySelector('.consent')?.children ?? []).map(
      (child: Element): string => child.tagName.toLowerCase(),
    );
    expect(order).toEqual(['h2', 'p', 'p', 'dl', 'app-button-row']);
  });

  it('facts_forANewInstall_showTheVersion', async (): Promise<void> => {
    const host: HTMLElement | null = await present(summary());

    expect(textsOf(host, 'dt')).toEqual(['Version', 'Downloads']);
    expect(textsOf(host, 'dd')[0]).toBe('0.15.0');
  });

  it('facts_forAnUpdate_showInstalledAndUpdatingTo', async (): Promise<void> => {
    const host: HTMLElement | null = await present(summary({ installedVersion: '0.14.0' }));

    expect(textsOf(host, 'dt')).toEqual(['Installed', 'Updating to', 'Downloads']);
    expect(textsOf(host, 'dd').slice(0, 2)).toEqual(['0.14.0', '0.15.0']);
  });

  it('origin_namesThePackagesAndTheirHosts', async (): Promise<void> => {
    const host: HTMLElement | null = await present(summary());

    expect(textsOf(host, 'dd')[1]).toBe('11 packages from registry.npmjs.org, github.com');
  });

  it('origin_ofOnePackage_isSingular', async (): Promise<void> => {
    const host: HTMLElement | null = await present(
      summary({ origin: { hosts: ['github.com'], packageCount: 1 } }),
    );

    expect(textsOf(host, 'dd')[1]).toBe('1 package from github.com');
  });

  it('origin_whenStudioCannotDescribeIt_showsNoDownloadsLine', async (): Promise<void> => {
    const host: HTMLElement | null = await present(summary({ origin: null }));

    expect(textsOf(host, 'dt')).toEqual(['Version']);
  });

  it('install_emitsAccepted', async (): Promise<void> => {
    const host: HTMLElement | null = await present(summary());

    actions(host)[0].querySelector('button')?.click();

    expect(accepted).toBe(1);
    expect(declined).toBe(0);
  });

  it('cancel_emitsDeclined', async (): Promise<void> => {
    const host: HTMLElement | null = await present(summary());

    actions(host)[1].querySelector('button')?.click();

    expect(declined).toBe(1);
    expect(accepted).toBe(0);
  });

  it('dismissing_meansDeclining', async (): Promise<void> => {
    await present(summary());

    windows.notifyClosed();

    expect(declined).toBe(1);
    expect(accepted).toBe(0);
  });
});
