import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import type { TrustQuestion } from '@shared/api/trust-channels';
import { RepositoryTrustModal } from './repository-trust-modal';

describe('RepositoryTrustModal', () => {
  let fixture: ComponentFixture<RepositoryTrustModal>;
  let windows: FakeModalWindows;
  let accepted: number;
  let declined: number;
  let scanned: number;
  let deferred: number;
  let cancelled: number;

  /**
   * A representative question.
   */
  const question: TrustQuestion = { folder: '/ws/aero', name: 'aero', scannable: true };

  beforeEach(async (): Promise<void> => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [RepositoryTrustModal],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(RepositoryTrustModal);
    accepted = 0;
    declined = 0;
    scanned = 0;
    fixture.componentInstance.scanned.subscribe((): number => (scanned += 1));
    fixture.componentInstance.accepted.subscribe((): number => (accepted += 1));
    fixture.componentInstance.declined.subscribe((): number => (declined += 1));
    deferred = 0;
    cancelled = 0;
    fixture.componentInstance.deferred.subscribe((): number => (deferred += 1));
    fixture.componentInstance.cancelled.subscribe((): number => (cancelled += 1));
  });

  /**
   * Asks the question, then returns the content host of the window the modal opened.
   * @param asked The question, or null when nothing is being asked.
   * @returns Returns the content host, or null when no window was opened.
   */
  async function present(asked: TrustQuestion | null): Promise<HTMLElement | null> {
    fixture.componentRef.setInput('question', asked);
    fixture.detectChanges();
    await fixture.whenStable();
    return windows.contentHost;
  }

  /**
   * Reads the dialog's Trust and Don't Trust actions, in the order they are drawn.
   * @param host The dialog's content host.
   * @returns Returns the action hosts.
   */
  function actions(host: HTMLElement | null): HTMLElement[] {
    return Array.from(host?.querySelectorAll<HTMLElement>('app-button-row app-button') ?? []);
  }

  it('render_whenNothingIsAsked_opensNoWindow', async (): Promise<void> => {
    const host: HTMLElement | null = await present(null);

    expect(host).toBeNull();
    expect(windows.requests).toEqual([]);
  });

  it('render_whenAsked_presentsAFramelessWindowNamingTheFolder', async (): Promise<void> => {
    const host: HTMLElement | null = await present(question);

    expect(windows.requests[0]?.frameless).toBe(true);
    expect(host?.querySelector('.trust__title')?.textContent).toContain(
      'Do you trust this folder?',
    );
    expect(host?.querySelector('dl')?.textContent).toContain('aero');
    expect(host?.querySelector('.trust__path')?.textContent).toBe('/ws/aero');
  });

  it('facts_renderAfterTheTwoParagraphs_thenTheScanNote_andTheActions', async (): Promise<void> => {
    const host: HTMLElement | null = await present(question);

    const order: string[] = Array.from(host?.querySelector('.trust')?.children ?? []).map(
      (child: Element): string => child.tagName.toLowerCase(),
    );
    expect(order).toEqual(['h2', 'p', 'p', 'dl', 'p', 'div']);
  });

  it('scanWithAi_isOfferedForAnOpenWorkspace_andEmitsScanned', async (): Promise<void> => {
    const host: HTMLElement | null = await present(question);

    const scan: HTMLElement | null = host?.querySelector('[data-testid="trust-scan"]') ?? null;
    expect(scan?.textContent?.trim()).toBe('Scan with AI');
    scan?.querySelector('button')?.click();

    expect(scanned).toBe(1);
    expect(accepted + declined).toBe(0);
  });

  it('scanWithAi_isNotOffered_whereItCannotRun', async (): Promise<void> => {
    const host: HTMLElement | null = await present({ ...question, scannable: false });

    expect(host?.querySelector('[data-testid="trust-scan"]')).toBeNull();
    expect(host?.querySelector('.trust__note')).toBeNull();
  });

  it('trust_isTheSolidFirstButton_andEmitsAccepted', async (): Promise<void> => {
    const host: HTMLElement | null = await present(question);

    const trust: HTMLElement = actions(host)[0];
    expect(trust.textContent?.trim()).toBe('Trust');
    expect(trust.classList.contains('button--solid')).toBe(true);
    trust.querySelector('button')?.click();

    expect(accepted).toBe(1);
    expect(declined).toBe(0);
  });

  it('dontTrust_isTheQuietDangerSecondButton_andEmitsDeclined', async (): Promise<void> => {
    const host: HTMLElement | null = await present(question);

    const dontTrust: HTMLElement = actions(host)[1];
    expect(dontTrust.textContent?.trim()).toBe("Don't Trust");
    expect(dontTrust.classList.contains('button--none')).toBe(true);
    expect(dontTrust.classList.contains('button--tone-danger')).toBe(true);
    dontTrust.querySelector('button')?.click();

    expect(declined).toBe(1);
    expect(accepted).toBe(0);
  });

  it('dismissing_meansNotTrusting', async (): Promise<void> => {
    await present(question);

    windows.notifyClosed();

    expect(declined).toBe(1);
    expect(accepted).toBe(0);
  });

  describe('before a clone (#1504)', () => {
    /**
     * A question asked before a clone.
     */
    const clone: TrustQuestion = {
      folder: '/clones/aero',
      name: 'aero',
      scannable: false,
      source: 'https://github.com/a/aero.git',
    };

    it('asksAboutTheRepository_namingWhereItComesFrom', async (): Promise<void> => {
      const host: HTMLElement | null = await present(clone);

      expect(host?.querySelector('.trust__title')?.textContent).toContain(
        'Do you trust this repository?',
      );
      expect(host?.querySelector('[data-testid="trust-source"]')?.textContent).toBe(
        'https://github.com/a/aero.git',
      );
      expect(host?.querySelector('.trust')?.textContent).toContain(
        'Nothing has been downloaded yet',
      );
    });

    it('offersDecideLater_inPlaceOfScanWithAi', async (): Promise<void> => {
      const host: HTMLElement | null = await present(clone);

      expect(host?.querySelector('[data-testid="trust-scan"]')).toBeNull();
      const later: HTMLElement | null = host?.querySelector('[data-testid="trust-later"]') ?? null;
      expect(later?.textContent?.trim()).toBe('Decide Later');
      later?.querySelector('button')?.click();

      expect(deferred).toBe(1);
      expect(accepted + declined + cancelled).toBe(0);
    });

    it('dismissing_clonesNothing', async (): Promise<void> => {
      await present(clone);

      windows.notifyClosed();

      expect(cancelled).toBe(1);
      expect(declined).toBe(0);
    });
  });

  it('aFolderQuestion_namesNoSource_andOffersNoDecideLater', async (): Promise<void> => {
    const host: HTMLElement | null = await present(question);

    expect(host?.querySelector('[data-testid="trust-source"]')).toBeNull();
    expect(host?.querySelector('[data-testid="trust-later"]')).toBeNull();
  });
});
