import { ComponentFixture, TestBed } from '@angular/core/testing';

import type {
  Notification,
  NotificationAction,
  NotificationSeverity,
} from '@shared/angular/services/notifications/notifications';
import { ToastCard } from './toast-card';

/**
 * Builds a notification.
 * @param severity Its severity.
 * @param actions Its actions.
 * @returns Returns the notification.
 */
function notification(
  severity: NotificationSeverity,
  actions: readonly NotificationAction[] = [],
): Notification {
  return {
    id: 1,
    severity,
    title: 'Pushed',
    detail: 'main → origin',
    actions,
    sticky: false,
    timestamp: 0,
  };
}

describe('ToastCard', () => {
  let fixture: ComponentFixture<ToastCard>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ToastCard] }).compileComponents();
    fixture = TestBed.createComponent(ToastCard);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Renders a notification.
   * @param value The notification.
   */
  function render(value: Notification): void {
    fixture.componentRef.setInput('notification', value);
    fixture.detectChanges();
  }

  it('drawsTitleAndDetail', () => {
    render(notification('info'));

    expect(host.querySelector('.toast__title')?.textContent?.trim()).toBe('Pushed');
    expect(host.querySelector('.toast__detail')?.textContent?.trim()).toBe('main → origin');
  });

  it('theSeverity_coloursTheCard_andErrorsAreAlerts', () => {
    render(notification('error'));

    expect(host.classList).toContain('toast');
    expect(host.classList).toContain('toast--error');
    expect(host.getAttribute('role')).toBe('alert');
  });

  it('otherSeverities_areStatuses', () => {
    for (const severity of ['info', 'success', 'warning'] as const) {
      render(notification(severity));

      expect(host.classList).toContain(`toast--${severity}`);
      expect(host.getAttribute('role')).toBe('status');
    }
  });

  it('theCloseButton_reportsAndNamesItsVerb', () => {
    let closed: number = 0;
    fixture.componentInstance.closed.subscribe((): void => void closed++);
    fixture.componentRef.setInput('closeVerb', 'Remove');
    render(notification('info'));

    const close: HTMLButtonElement = host.querySelector<HTMLButtonElement>('.toast__close button')!;
    close.click();

    expect(closed).toBe(1);
    expect(close.getAttribute('aria-label')).toBe('Remove: Pushed');
  });

  it('anActionButton_reportsItsAction', () => {
    const push: NotificationAction = { label: 'Push', run: (): void => undefined };
    const acted: NotificationAction[] = [];
    fixture.componentInstance.acted.subscribe(
      (action: NotificationAction): void => void acted.push(action),
    );
    render(notification('success', [push]));

    host.querySelector<HTMLButtonElement>('.toast__actions button')?.click();

    expect(acted).toEqual([push]);
  });

  it('plain_greysTheCard_andItsButtons_butKeepsItsRole', () => {
    fixture.componentRef.setInput('plain', true);
    render(notification('error', [{ label: 'Retry', run: (): void => undefined }]));

    expect(host.classList).toContain('toast--plain');
    expect(host.getAttribute('role')).toBe('alert');
    expect(host.querySelector('.toast__actions app-button')?.classList).toContain(
      'button--tone-neutral',
    );
  });

  describe("Don't Show Again (#1487)", () => {
    it('isOfferedOnlyWhenTheSurfaceSaysSo', () => {
      render(notification('error'));

      expect(host.querySelector('.toast__options')).toBeNull();
    });

    it('reportsDontShowAgain_andNotificationSettings', () => {
      let silenced: number = 0;
      let configured: number = 0;
      fixture.componentInstance.silenced.subscribe((): number => (silenced += 1));
      fixture.componentInstance.configured.subscribe((): number => (configured += 1));
      fixture.componentRef.setInput('silenceable', true);
      fixture.componentRef.setInput('configurable', true);
      render(notification('error'));

      host.querySelector<HTMLButtonElement>('[data-testid="toast-silence"] button')?.click();
      host.querySelector<HTMLButtonElement>('[data-testid="toast-configure"] button')?.click();

      expect(silenced).toBe(1);
      expect(configured).toBe(1);
    });

    it('keepsTheChoicesApartFromTheNotificationsOwnActions', () => {
      fixture.componentRef.setInput('silenceable', true);
      render(notification('error', [{ label: 'Show Logs', run: (): void => undefined }]));

      expect(host.querySelector('.toast__actions [data-testid="toast-silence"]')).toBeNull();
      expect(host.querySelector('.toast__options [data-testid="toast-silence"]')).not.toBeNull();
    });
  });
});
