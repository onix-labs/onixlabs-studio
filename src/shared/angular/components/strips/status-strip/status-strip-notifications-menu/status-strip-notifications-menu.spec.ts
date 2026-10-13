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

  it('render_whenMoreAreUnseenThanTheBadgeSpellsOut_showsNinetyNinePlus', () => {
    // The history caps itself, so the count pins rather than climbing; the badge must say "more
    // than 99" instead of reading out the cap as though it were the real figure.
    for (let raised: number = 0; raised < 120; raised += 1) {
      notifications.notify({ severity: 'info', title: `N${raised}` });
    }
    fixture.detectChanges();

    const trigger: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.notifications-menu__trigger',
    );
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.notifications-menu__count')
        ?.textContent,
    ).toBe('99+');
    expect(trigger?.getAttribute('title')).toBe('More than 99 new notifications');
  });

  it('render_whenExactlyTheBadgeLimitIsUnseen_stillSpellsItOut', () => {
    for (let raised: number = 0; raised < 99; raised += 1) {
      notifications.notify({ severity: 'info', title: `N${raised}` });
    }
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.notifications-menu__count')
        ?.textContent,
    ).toBe('99');
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

  it('render_whenMuted_showsTheSlashedBell', () => {
    fixture.detectChanges();
    const icon: () => string = (): string =>
      (fixture.nativeElement as HTMLElement)
        .querySelector('.notifications-menu__trigger app-icon i')
        ?.className.toString() ?? '';
    expect(icon()).toContain('ph-bell-ringing');

    notifications.setMuted(true);
    fixture.detectChanges();

    expect(icon()).toContain('ph-bell-slash');
    expect(icon()).toContain('ph-duotone');
  });

  it('toggleMute_flipsTheStoresMute', () => {
    const component: { toggleMute(): void } = fixture.componentInstance as unknown as {
      toggleMute(): void;
    };

    component.toggleMute();
    expect(notifications.muted()).toBe(true);

    component.toggleMute();
    expect(notifications.muted()).toBe(false);
  });
});
