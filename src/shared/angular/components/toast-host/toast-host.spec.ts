import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Notifications } from '@shared/angular/services/notifications/notifications';
import { NotificationPosition, Settings } from '@shared/angular/services/settings/settings';
import { ToastHost } from './toast-host';

describe('ToastHost', () => {
  let fixture: ComponentFixture<ToastHost>;
  let host: HTMLElement;
  let notifications: Notifications;
  let position: WritableSignal<NotificationPosition>;

  beforeEach(async () => {
    vi.useFakeTimers();
    position = signal<NotificationPosition>('bottom-right');
    const settingsStub: Partial<Settings> = {
      get: ((key: string): unknown =>
        key === 'notifications.toastDuration' ? 5 : 'nothing') as Settings['get'],
      value: (() => position.asReadonly()) as unknown as Settings['value'],
    };
    await TestBed.configureTestingModule({
      imports: [ToastHost],
      providers: [{ provide: Settings, useValue: settingsStub }],
    }).compileComponents();
    notifications = TestBed.inject(Notifications);
    fixture = TestBed.createComponent(ToastHost);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Raises a notification and renders.
   * @param title Its title.
   * @param sticky Whether it stays until dismissed.
   */
  function raise(title: string, sticky: boolean = false): void {
    notifications.notify({ severity: 'info', title, sticky });
    fixture.detectChanges();
  }

  /**
   * Gets the drawn cards' titles with their depth classes, front first.
   * @returns Returns `title@depth` per card.
   */
  function drawn(): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('app-toast-card'))
      .map((card: HTMLElement): string => {
        const depth: string | undefined = Array.from(card.classList)
          .find((name: string): boolean => name.startsWith('toast-stack__card--depth-'))
          ?.replace('toast-stack__card--depth-', '');
        return `${card.querySelector('.toast__title')?.textContent?.trim()}@${depth}`;
      })
      .sort((a: string, b: string): number => a.slice(-1).localeCompare(b.slice(-1)));
  }

  it('oneToast_isDrawnInFront', () => {
    raise('First');

    expect(drawn()).toEqual(['First@0']);
  });

  it('theStack_drawsAtMostThree_newestInFront', () => {
    raise('One', true);
    raise('Two', true);
    raise('Three', true);
    raise('Four', true);

    expect(drawn()).toEqual(['Four@0', 'Three@1', 'Two@2']);
  });

  it('theToastsBehind_areInertAndHidden_soOnlyTheFrontCanBePressed', () => {
    raise('Back', true);
    raise('Front', true);

    const cards: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('app-toast-card'));
    const back: HTMLElement = cards.find((card: HTMLElement): boolean =>
      card.classList.contains('toast-stack__card--depth-1'),
    )!;
    const front: HTMLElement = cards.find((card: HTMLElement): boolean =>
      card.classList.contains('toast-stack__card--depth-0'),
    )!;
    expect(back.inert).toBe(true);
    expect(back.getAttribute('aria-hidden')).toBe('true');
    expect(front.inert).toBe(false);
  });

  it('dismissingTheFront_bringsTheNextForward', () => {
    raise('Back', true);
    raise('Front', true);

    host.querySelector<HTMLElement>('.toast-stack__card--depth-0 .toast__close button')?.click();
    fixture.detectChanges();

    expect(drawn()).toEqual(['Back@0']);
  });

  it('onlyTheFrontToast_countsDown_soAToastBehindIsNotLostUnseen', () => {
    raise('Back');
    raise('Front');

    vi.advanceTimersByTime(5000);
    fixture.detectChanges();
    expect(drawn()).toEqual(['Back@0']);

    vi.advanceTimersByTime(5000);
    fixture.detectChanges();
    expect(drawn()).toEqual([]);
  });

  it('hoveringTheFront_holdsItsCountdown', () => {
    raise('Front');
    const front: HTMLElement = host.querySelector<HTMLElement>('app-toast-card')!;

    front.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(10000);
    fixture.detectChanges();
    expect(drawn()).toEqual(['Front@0']);

    front.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(5000);
    fixture.detectChanges();
    expect(drawn()).toEqual([]);
  });

  it('anAction_runsAndDismissesItsToast', () => {
    let ran: number = 0;
    notifications.notify({
      severity: 'info',
      title: 'Act',
      sticky: true,
      actions: [{ label: 'Go', run: (): void => void ran++ }],
    });
    fixture.detectChanges();

    host.querySelector<HTMLElement>('.toast__actions button')?.click();
    fixture.detectChanges();

    expect(ran).toBe(1);
    expect(drawn()).toEqual([]);
  });

  it('theRibbonPosition_marksTheHost', () => {
    expect(host.classList.contains('toast-host--ribbon')).toBe(false);

    position.set('ribbon');
    fixture.detectChanges();

    expect(host.classList.contains('toast-host--ribbon')).toBe(true);
  });
});
