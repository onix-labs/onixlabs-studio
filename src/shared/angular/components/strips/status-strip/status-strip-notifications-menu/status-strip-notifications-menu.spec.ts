import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { StatusStripNotificationsMenu } from './status-strip-notifications-menu';

describe('StatusStripNotificationsMenu', () => {
  let fixture: ComponentFixture<StatusStripNotificationsMenu>;
  let notifications: Notifications;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusStripNotificationsMenu],
    }).compileComponents();

    notifications = TestBed.inject(Notifications);
    fixture = TestBed.createComponent(StatusStripNotificationsMenu);
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenNothingIsUnseen_showsAPlainBell', () => {
    fixture.detectChanges();

    const trigger: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.notifications-menu__trigger',
    );
    expect(trigger?.classList).not.toContain('notifications-menu__trigger--alert');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.notifications-menu__count'),
    ).toBeNull();
  });

  it('render_whenNotificationsAreUnseen_showsTheCountAndAlertStyling', () => {
    notifications.notify({ severity: 'info', title: 'A' });
    notifications.notify({ severity: 'error', title: 'B' });
    fixture.detectChanges();

    const trigger: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.notifications-menu__trigger',
    );
    expect(trigger?.classList).toContain('notifications-menu__trigger--alert');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.notifications-menu__count')
        ?.textContent,
    ).toBe('2');
  });

  it('render_titlesTheTriggerWithTheUnseenCount', () => {
    notifications.notify({ severity: 'info', title: 'A' });
    fixture.detectChanges();

    const trigger: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.notifications-menu__trigger',
    );
    expect(trigger?.getAttribute('title')).toBe('1 new notification');
  });

  it('onOpened_marksEverythingSeen', () => {
    notifications.notify({ severity: 'info', title: 'A' });

    (fixture.componentInstance as unknown as { onOpened(): void }).onOpened();

    expect(notifications.unseenCount()).toBe(0);
  });

  it('clearAll_delegatesToTheStore', () => {
    notifications.notify({ severity: 'info', title: 'A' });

    (fixture.componentInstance as unknown as { clearAll(): void }).clearAll();

    expect(notifications.history().length).toBe(0);
  });

  it('relativeTime_formatsCoarseAges', () => {
    const component: { relativeTime(timestamp: number): string } =
      fixture.componentInstance as unknown as { relativeTime(timestamp: number): string };
    const now: number = Date.now();

    expect(component.relativeTime(now)).toBe('just now');
    expect(component.relativeTime(now - 5 * 60_000)).toBe('5m ago');
    expect(component.relativeTime(now - 3 * 3_600_000)).toBe('3h ago');
    expect(component.relativeTime(now - 2 * 86_400_000)).toBe('2d ago');
  });
});
