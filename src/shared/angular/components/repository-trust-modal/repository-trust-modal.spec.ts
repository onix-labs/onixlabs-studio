import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import type { RepositoryTrustQuestion } from '@shared/angular/services/repository-trust/repository-trust';
import { RepositoryTrustModal } from './repository-trust-modal';

describe('RepositoryTrustModal', () => {
  let fixture: ComponentFixture<RepositoryTrustModal>;
  let windows: FakeModalWindows;
  let accepted: number;
  let declined: number;

  /**
   * A representative question.
   */
  const question: RepositoryTrustQuestion = { root: '/ws/aero', name: 'aero' };

  beforeEach(async (): Promise<void> => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [RepositoryTrustModal],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    fixture = TestBed.createComponent(RepositoryTrustModal);
    accepted = 0;
    declined = 0;
    fixture.componentInstance.accepted.subscribe((): number => (accepted += 1));
    fixture.componentInstance.declined.subscribe((): number => (declined += 1));
  });

  /**
   * Asks the question, then returns the content host of the window the modal opened.
   * @param asked The question, or null when nothing is being asked.
   * @returns Returns the content host, or null when no window was opened.
   */
  async function present(asked: RepositoryTrustQuestion | null): Promise<HTMLElement | null> {
    fixture.componentRef.setInput('question', asked);
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

  it('render_whenNothingIsAsked_opensNoWindow', async (): Promise<void> => {
    const host: HTMLElement | null = await present(null);

    expect(host).toBeNull();
    expect(windows.requests).toEqual([]);
  });

  it('render_whenAsked_presentsAFramelessWindowNamingTheRepository', async (): Promise<void> => {
    const host: HTMLElement | null = await present(question);

    expect(windows.requests[0]?.frameless).toBe(true);
    expect(host?.querySelector('.trust__title')?.textContent).toContain(
      'Do you trust this repository?',
    );
    expect(host?.querySelector('dl')?.textContent).toContain('aero');
    expect(host?.querySelector('.trust__path')?.textContent).toBe('/ws/aero');
  });

  it('facts_renderAfterTheTwoParagraphs_andBeforeTheActions', async (): Promise<void> => {
    const host: HTMLElement | null = await present(question);

    const order: string[] = Array.from(host?.querySelector('.trust')?.children ?? []).map(
      (child: Element): string => child.tagName.toLowerCase(),
    );
    expect(order).toEqual(['h2', 'p', 'p', 'dl', 'app-button-row']);
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
    expect(dontTrust.textContent?.trim()).toBe("Don't trust");
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
});
