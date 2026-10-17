import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Notifications } from '@shared/angular/services/notifications/notifications';
import {
  NotificationColour,
  NotificationStacking,
  Settings,
} from '@shared/angular/services/settings/settings';
import { ToastHost } from './toast-host';

describe('ToastHost', () => {
  let fixture: ComponentFixture<ToastHost>;
  let host: HTMLElement;
  let notifications: Notifications;
  let stacking: WritableSignal<NotificationStacking>;
  let colour: WritableSignal<NotificationColour>;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Backwards unless a test says otherwise: most of what is asserted is the receding stack.
    stacking = signal<NotificationStacking>('backwards');
    colour = signal<NotificationColour>('all');
    const settingsStub: Partial<Settings> = {
      get: ((key: string): unknown =>
        key === 'notifications.toastDuration' ? 5 : 'nothing') as Settings['get'],
      value: ((key: string): unknown =>
        key === 'notifications.stacking'
          ? stacking.asReadonly()
          : colour.asReadonly()) as unknown as Settings['value'],
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

  /**
   * Raises a notification of a severity and renders.
   * @param title Its title.
   * @param severity Its severity.
   */
  function raiseAs(title: string, severity: 'info' | 'success' | 'warning' | 'error'): void {
    notifications.notify({ severity, title, sticky: true });
    fixture.detectChanges();
  }

  /**
   * Gets the titles of the cards drawn in grey.
   * @returns Returns the titles.
   */
  function grey(): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('app-toast-card.toast--plain')).map(
      (card: HTMLElement): string => card.querySelector('.toast__title')?.textContent?.trim() ?? '',
    );
  }

  it('upwards_drawsEveryToastAsAColumn_newestFirst_allPressable', () => {
    stacking.set('upwards');
    raise('One', true);
    raise('Two', true);
    raise('Three', true);
    raise('Four', true);

    const cards: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('app-toast-card'));
    expect(
      cards.map((card: HTMLElement) => card.querySelector('.toast__title')?.textContent?.trim()),
    ).toEqual(['Four', 'Three', 'Two', 'One']);
    expect(cards.every((card: HTMLElement): boolean => !card.inert)).toBe(true);
    expect(host.querySelector('.toast-stack--upwards')).not.toBeNull();
  });

  it('upwards_everyToastCountsDown', () => {
    stacking.set('upwards');
    raise('Older');
    raise('Newer');

    vi.advanceTimersByTime(5000);
    fixture.detectChanges();

    expect(host.querySelectorAll('app-toast-card')).toHaveLength(0);
  });

  it('upwards_hoveringOneToast_holdsOnlyItsCountdown', () => {
    stacking.set('upwards');
    raise('Running');
    raise('Held');
    // The newest heads the column.
    host.querySelector<HTMLElement>('app-toast-card')!.dispatchEvent(new MouseEvent('mouseenter'));

    vi.advanceTimersByTime(5000);
    fixture.detectChanges();

    expect(
      Array.from(host.querySelectorAll('.toast__title')).map((title) => title.textContent?.trim()),
    ).toEqual(['Held']);
  });

  it('colourAll_coloursEveryToast', () => {
    raiseAs('Red', 'error');
    raiseAs('Yellow', 'warning');
    raiseAs('Green', 'success');

    expect(grey()).toEqual([]);
  });

  it('colourNewestOnly_greysAllButTheNewest_andTheColourMovesOnDismissal', () => {
    colour.set('newest');
    raiseAs('Red', 'error');
    raiseAs('Yellow', 'warning');
    raiseAs('Green', 'success');

    expect(grey().sort()).toEqual(['Red', 'Yellow']);

    host.querySelector<HTMLElement>('.toast-stack__card--depth-0 .toast__close button')?.click();
    fixture.detectChanges();

    expect(grey()).toEqual(['Red']);
  });

  it('colourNewestOnly_appliesStackingUpwardsToo', () => {
    stacking.set('upwards');
    colour.set('newest');
    raiseAs('Red', 'error');
    raiseAs('Green', 'success');

    expect(grey()).toEqual(['Red']);
  });
});
