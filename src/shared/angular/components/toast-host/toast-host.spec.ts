import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ButtonTone } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { severityIcon } from '@shared/angular/icons/severity-icon';
import {
  Notification,
  Notifications,
  NotificationSeverity,
} from '@shared/angular/services/notifications/notifications';
import { Settings } from '@shared/angular/services/settings/settings';
import { ToastHost } from './toast-host';

/**
 * The tile's severity-mapping helpers read by the tests, exposed off the protected surface so the
 * severity → tone and severity → icon contracts can be asserted without rendering.
 */
interface ToastHostInternals {
  toneFor(severity: NotificationSeverity): ButtonTone;
  iconFor(severity: NotificationSeverity): Icon;
}

/**
 * Builds a toast host with empty, stubbed stores — no toasts arrive, so no auto-dismiss timers run —
 * and returns it cast to its mapping helpers.
 * @returns Returns the toast host's severity-mapping surface.
 */
function setUp(): ToastHostInternals {
  const notificationsStub: Partial<Notifications> = {
    toasts: signal<readonly Notification[]>([]),
    dismiss: (): void => undefined,
  };
  const settingsStub: Partial<Settings> = {
    get: (() => 5) as Settings['get'],
  };

  TestBed.configureTestingModule({
    imports: [ToastHost],
    providers: [
      { provide: Notifications, useValue: notificationsStub },
      { provide: Settings, useValue: settingsStub },
    ],
  });

  return TestBed.createComponent(ToastHost).componentInstance as unknown as ToastHostInternals;
}

describe('ToastHost', () => {
  it('toneFor_mapsErrorToDanger_soTheDismissButtonReadsRedLikeAnErrorCard', () => {
    const host: ToastHostInternals = setUp();

    expect(host.toneFor('error')).toBe('danger');
  });

  it('toneFor_sharesEachOtherSeveritysNameWithItsTone', () => {
    const host: ToastHostInternals = setUp();

    expect(host.toneFor('info')).toBe('info');
    expect(host.toneFor('success')).toBe('success');
    expect(host.toneFor('warning')).toBe('warning');
  });

  it('iconFor_resolvesTheSeveritysIcon', () => {
    const host: ToastHostInternals = setUp();

    for (const severity of ['info', 'success', 'warning', 'error'] as const) {
      expect(host.iconFor(severity)).toBe(severityIcon(severity));
    }
  });
});
