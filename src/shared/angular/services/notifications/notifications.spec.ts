import { TestBed } from '@angular/core/testing';

import { Notification, Notifications } from './notifications';

describe('Notifications', () => {
  let service: Notifications;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Notifications);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('notify_whenErrorSeverity_defaultsToSticky', () => {
    service.notify({ severity: 'error', title: 'Push failed' });

    expect(service.toasts()[0].sticky).toBe(true);
  });

  it('notify_whenInfoSeverity_defaultsToTransient', () => {
    service.notify({ severity: 'info', title: 'Fetched all remotes' });

    expect(service.toasts()[0].sticky).toBe(false);
  });

  it('notify_whenStickyOverridden_respectsTheOverride', () => {
    service.notify({ severity: 'error', title: 'Push failed', sticky: false });

    expect(service.toasts()[0].sticky).toBe(false);
  });

  it('notify_whenActionsOmitted_defaultsToEmpty', () => {
    service.notify({ severity: 'success', title: 'Committed' });

    expect(service.toasts()[0].actions).toEqual([]);
  });

  it('notify_whenKeyMatchesLiveToast_replacesItInPlace', () => {
    service.notify({ severity: 'info', title: 'First', key: 'other' });
    service.notify({ severity: 'error', title: 'Push failed', key: 'push' });

    service.notify({ severity: 'success', title: 'Pushed main', key: 'push' });

    const titles: readonly string[] = service
      .toasts()
      .map((toast: Notification): string => toast.title);
    expect(titles).toEqual(['First', 'Pushed main']);
  });

  it('notify_whenStackIsFull_evictsTheOldestTransientToast', () => {
    service.notify({ severity: 'error', title: 'Sticky' });
    service.notify({ severity: 'info', title: 'Transient A' });
    service.notify({ severity: 'info', title: 'Transient B' });
    service.notify({ severity: 'info', title: 'Transient C' });
    service.notify({ severity: 'info', title: 'Transient D' });

    service.notify({ severity: 'info', title: 'Overflow' });

    const titles: readonly string[] = service
      .toasts()
      .map((toast: Notification): string => toast.title);
    expect(titles).toEqual(['Sticky', 'Transient B', 'Transient C', 'Transient D', 'Overflow']);
  });

  it('notify_whenStackIsFullOfStickyToasts_evictsTheOldest', () => {
    for (let index: number = 0; index < 5; index++) {
      service.notify({ severity: 'error', title: `Sticky ${index}` });
    }

    service.notify({ severity: 'error', title: 'Overflow' });

    const titles: readonly string[] = service
      .toasts()
      .map((toast: Notification): string => toast.title);
    expect(titles).toEqual(['Sticky 1', 'Sticky 2', 'Sticky 3', 'Sticky 4', 'Overflow']);
  });

  it('dismiss_whenCalled_removesOnlyThatToast', () => {
    service.notify({ severity: 'info', title: 'Keep' });
    service.notify({ severity: 'info', title: 'Drop' });
    const dropped: Notification = service.toasts()[1];

    service.dismiss(dropped.id);

    const titles: readonly string[] = service
      .toasts()
      .map((toast: Notification): string => toast.title);
    expect(titles).toEqual(['Keep']);
  });

  it('dismissAll_whenCalled_clearsTheStack', () => {
    service.notify({ severity: 'info', title: 'A' });
    service.notify({ severity: 'error', title: 'B' });

    service.dismissAll();

    expect(service.toasts().length).toBe(0);
  });
});
