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

  describe('commands and details (#1255)', () => {
    /**
     * The notification an unknown SSH host raises.
     */
    const unknownHost: Notification = {
      ...notification('error'),
      title: 'Fetch failed — studio',
      detail: "SSH doesn't know the host key of github.com yet.",
      commands: ['ssh -T git@github.com', 'ssh-keyscan github.com | ssh-keygen -lf -'],
      output: 'Host key verification failed.\nfatal: Could not read from remote repository.',
    };

    it('showsEachCommandAsCode_andCopiesIt', async () => {
      const copied: string[] = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string): Promise<void> => Promise.resolve(void copied.push(text)),
        },
      });
      render(unknownHost);

      const commands: string[] = [
        ...host.querySelectorAll<HTMLElement>('[data-testid="toast-command"] code'),
      ].map((code: HTMLElement): string => code.textContent ?? '');
      host
        .querySelectorAll<HTMLButtonElement>('[data-testid="toast-copy-command"] button')[1]
        ?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(commands).toEqual(unknownHost.commands);
      expect(copied).toEqual(['ssh-keyscan github.com | ssh-keygen -lf -']);
      expect(
        host
          .querySelectorAll('[data-testid="toast-copy-command"] button')[1]
          ?.getAttribute('aria-label'),
      ).toBe('Copied');
    });

    it('keepsTheToolsOutputUnderShowDetails', () => {
      render(unknownHost);

      expect(host.querySelector('[data-testid="toast-output"]')).toBeNull();
      host.querySelector<HTMLButtonElement>('[data-testid="toast-details"] button')?.click();
      fixture.detectChanges();

      expect(host.querySelector('[data-testid="toast-output"]')?.textContent).toBe(
        unknownHost.output,
      );
      expect(host.querySelector('[data-testid="toast-details"] button')?.textContent?.trim()).toBe(
        'Hide Details',
      );
    });

    it('offersNeitherWithoutThem', () => {
      render(notification('error'));

      expect(host.querySelector('[data-testid="toast-command"]')).toBeNull();
      expect(host.querySelector('[data-testid="toast-details"]')).toBeNull();
    });
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
