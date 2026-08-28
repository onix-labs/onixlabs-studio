import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationRef, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PluginSummary } from '@shared/api/plugin-channels';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { PluginConsent } from '@shared/angular/services/plugins/plugin-consent';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { PluginConsentHost } from '@shared/angular/components/plugin-consent-modal/plugin-consent-host';
import { PluginManagerView } from './plugin-manager-view';

/**
 * Records what the view asked the plugin client to do, so a test can assert that clicking Install did
 * *not* install.
 */
interface StubPlugins {
  readonly installed: string[];
  readonly uninstalled: string[];
}

/**
 * Builds a plugin summary.
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
    origin: { hosts: ['registry.npmjs.org'], packageCount: 11 },
    installedVersion: null,
    ...overrides,
  };
}

describe('PluginManagerView', () => {
  let stub: StubPlugins;
  let windows: FakeModalWindows;
  let fixture: ComponentFixture<PluginManagerView>;
  let host: ComponentFixture<PluginConsentHost>;

  /**
   * Renders the view over a stub plugin client and a fake window opener, alongside the consent host
   * the application root mounts. The terms are no longer the view's own: the view asks through the
   * shared consent seam (as every other entry point to an install does), and the host renders the
   * question in its own window, so the terms are asserted through that window's content host rather
   * than anywhere in the view.
   * @param plugins The plugins the client reports.
   */
  function render(plugins: readonly PluginSummary[]): void {
    const known: WritableSignal<readonly PluginSummary[]> = signal(plugins);
    stub = { installed: [], uninstalled: [] };
    windows = new FakeModalWindows();
    const client: Partial<Plugins> = {
      plugins: known.asReadonly(),
      busy: signal(false).asReadonly(),
      error: signal<string | null>(null).asReadonly(),
      // The real client's consent-gated install, reduced to its shape: ask the shared seam, and
      // install only on acceptance.
      installWithConsent: async (id: string): Promise<void> => {
        const plugin: PluginSummary | undefined = known().find(
          (candidate: PluginSummary): boolean => candidate.id === id,
        );
        if (plugin !== undefined && (await TestBed.inject(PluginConsent).request(plugin))) {
          stub.installed.push(id);
        }
      },
      uninstall: (id: string): Promise<void> => {
        stub.uninstalled.push(id);
        return Promise.resolve();
      },
    };
    TestBed.configureTestingModule({
      imports: [PluginManagerView, PluginConsentHost],
      providers: [
        { provide: Plugins, useValue: client },
        { provide: ModalWindows, useValue: windows },
      ],
    });
    fixture = TestBed.createComponent(PluginManagerView);
    fixture.componentRef.setInput('tabId', 'tab');
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();
    host = TestBed.createComponent(PluginConsentHost);
    host.detectChanges();
  }

  /**
   * Flushes change detection through the view, the consent host, and the modal window's attached
   * view, then drains the microtasks a consent answer resolves through.
   */
  function flush(): void {
    fixture.detectChanges();
    host.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  }

  /**
   * Waits for the consent answer to reach the stub client (a promise hop) and re-renders.
   * @returns Returns a promise that resolves once the install decision has been applied.
   */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    flush();
  }

  /**
   * Gets the text rendered inside the open modal window, or an empty string when none is open.
   * @returns Returns the window's text content.
   */
  function modalText(): string {
    return windows.contentHost?.textContent ?? '';
  }

  /**
   * Clicks the first button in a root whose label matches.
   * @param root The element to search.
   * @param label The button label to click.
   */
  function clickIn(root: HTMLElement | null, label: string): void {
    const buttons: readonly HTMLButtonElement[] = [
      ...(root?.querySelectorAll('button') ?? []),
    ] as HTMLButtonElement[];
    const target: HTMLButtonElement | undefined = buttons.find((button): boolean =>
      (button.textContent ?? '').includes(label),
    );
    expect(target, `no button labelled ${label}`).toBeDefined();
    target?.click();
    flush();
  }

  /**
   * Clicks a row action in the view itself.
   * @param label The button label to click.
   */
  function click(label: string): void {
    clickIn(fixture.nativeElement as HTMLElement, label);
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('install_asksBeforeItInstallsAnything', () => {
    // The whole point of the phase: Install opens the terms, it does not begin an install.
    render([summary()]);

    click('Install');

    expect(stub.installed).toEqual([]);
    expect(windows.openWindows).toBe(1);
    expect(modalText()).toContain('Install Dockerfile Language Server?');
  });

  it('install_presentsTheTermsInTheirOwnWindow', () => {
    // Every modal is window-presented; nothing is drawn over the view that declared it.
    render([summary()]);

    click('Install');

    expect(windows.requests).toHaveLength(1);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'Install Dockerfile Language Server?',
    );
  });

  it('consent_saysWhatIsAndIsNotPromised', () => {
    render([summary()]);

    click('Install');

    expect(modalText()).toContain('Studio does not review what the code does');
    expect(modalText()).toContain('reads the projects you open with it');
  });

  it('consent_showsTheVersionAndWhatArrives', () => {
    // "Do I trust this?" needs enough on screen to answer: a dependency tree is written by many more
    // people than the one named on the entry, so the count is the number worth seeing.
    render([summary()]);

    click('Install');

    expect(modalText()).toContain('0.15.0');
    expect(modalText()).toContain('11 packages from registry.npmjs.org');
  });

  it('consent_forASingleArchive_saysOnePackage', () => {
    render([summary({ origin: { hosts: ['github.com'], packageCount: 1 } })]);

    click('Install');

    expect(modalText()).toContain('1 package from github.com');
  });

  it('consent_whenTheOriginIsUnknown_stillAsks', () => {
    // No provenance to show is not the same as nothing to accept, so the terms are still put up.
    render([summary({ origin: null })]);

    click('Install');

    expect(modalText()).toContain('Install Dockerfile Language Server?');
    expect(modalText()).not.toContain('Downloads');
  });

  it('decline_installsNothingAndClosesTheWindow', async () => {
    render([summary()]);
    click('Install');

    clickIn(windows.contentHost, 'Cancel');
    await settle();

    expect(stub.installed).toEqual([]);
    expect(windows.openWindows).toBe(0);
  });

  it('dismissingTheWindow_isTheSameAsDeclining', async () => {
    // Closing through the window's own chrome must not be a quiet acceptance.
    render([summary()]);
    click('Install');

    windows.notifyClosed();
    flush();
    await settle();

    expect(stub.installed).toEqual([]);
    expect(windows.openWindows).toBe(0);
  });

  it('accept_installsOnceAndClosesTheWindow', async () => {
    render([summary()]);
    click('Install');

    clickIn(windows.contentHost, 'Accept and install');
    await settle();

    expect(stub.installed).toEqual(['dockerfile-language-server']);
    expect(windows.openWindows).toBe(0);
  });

  it('anOutdatedInstall_offersAnUpdateRatherThanTakingOne', () => {
    // The user consented to a version. A catalogue that has moved on is an offer, not something that
    // arrives on its own — and the row says so rather than reading "Installed" while running old code.
    render([summary({ state: 'installed', version: '2.0.0', installedVersion: '1.0.0' })]);

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Update available');
    expect(text).toContain('1.0.0');
    expect(text).toContain('2.0.0');
    expect(stub.installed).toEqual([]);
  });

  it('update_asksAgainBeforeReplacingWhatWasAccepted', () => {
    render([summary({ state: 'installed', version: '2.0.0', installedVersion: '1.0.0' })]);

    click('Update');

    expect(stub.installed).toEqual([]);
    expect(windows.openWindows).toBe(1);
    expect(modalText()).toContain('Update Dockerfile Language Server?');
    expect(modalText()).toContain('Accept and update');
  });

  it('update_acceptedInstallsTheOfferedVersion', async () => {
    render([summary({ state: 'installed', version: '2.0.0', installedVersion: '1.0.0' })]);
    click('Update');

    clickIn(windows.contentHost, 'Accept and update');
    await settle();

    expect(stub.installed).toEqual(['dockerfile-language-server']);
  });

  it('anUpToDateInstall_offersNoUpdate', () => {
    render([summary({ state: 'installed', version: '1.0.0', installedVersion: '1.0.0' })]);
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Installed');
    expect(text).not.toContain('Update available');
  });

  it('uninstall_isNotGatedByTheTerms', () => {
    // The terms are about running someone else's code. Removing it is not that, and asking again
    // would be consent theatre.
    render([summary({ state: 'installed' })]);

    click('Remove');

    expect(stub.uninstalled).toEqual(['dockerfile-language-server']);
    expect(windows.openWindows).toBe(0);
  });
});
