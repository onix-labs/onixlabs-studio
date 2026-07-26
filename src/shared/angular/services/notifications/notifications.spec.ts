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

  it('notify_whenCalled_prependsToTheHistory', () => {
    service.notify({ severity: 'info', title: 'First' });
    service.notify({ severity: 'success', title: 'Second' });

    const titles: readonly string[] = service
      .history()
      .map((entry: Notification): string => entry.title);
    expect(titles).toEqual(['Second', 'First']);
  });

  it('notify_whenCalled_stampsTheTimestamp', () => {
    const before: number = Date.now();

    service.notify({ severity: 'info', title: 'Stamped' });

    expect(service.history()[0].timestamp).toBeGreaterThanOrEqual(before);
  });

  it('notify_whenCoalescing_keepsBothHistoryEntries', () => {
    service.notify({ severity: 'error', title: 'Push failed', key: 'push' });

    service.notify({ severity: 'success', title: 'Pushed main', key: 'push' });

    expect(service.toasts().length).toBe(1);
    expect(service.history().length).toBe(2);
  });

  it('history_whenOverCapacity_dropsTheOldestEntries', () => {
    for (let index: number = 0; index < 105; index++) {
      service.notify({ severity: 'info', title: `Entry ${index}` });
    }

    expect(service.history().length).toBe(100);
    expect(service.history()[0].title).toBe('Entry 104');
  });

  it('unseenCount_countsNotificationsRaisedSinceLastSeen', () => {
    service.notify({ severity: 'info', title: 'A' });
    service.notify({ severity: 'info', title: 'B' });

    expect(service.unseenCount()).toBe(2);
  });

  it('markAllSeen_whenCalled_zeroesTheUnseenCount', () => {
    service.notify({ severity: 'info', title: 'A' });

    service.markAllSeen();

    expect(service.unseenCount()).toBe(0);
  });

  it('markAllSeen_thenANewNotification_countsOnlyTheNewOne', () => {
    service.notify({ severity: 'info', title: 'Old' });
    service.markAllSeen();

    service.notify({ severity: 'info', title: 'New' });

    expect(service.unseenCount()).toBe(1);
  });

  it('dismiss_whenCalled_keepsTheHistoryEntry', () => {
    service.notify({ severity: 'error', title: 'Kept in history' });
    const toast: Notification = service.toasts()[0];

    service.dismiss(toast.id);

    expect(service.toasts().length).toBe(0);
    expect(service.history().length).toBe(1);
  });

  it('removeFromHistory_whenCalled_removesTheEntryAndItsLiveToast', () => {
    service.notify({ severity: 'error', title: 'Clear me' });
    const entry: Notification = service.history()[0];

    service.removeFromHistory(entry.id);

    expect(service.history().length).toBe(0);
    expect(service.toasts().length).toBe(0);
  });

  it('notify_whenRoutedHistoryOnly_recordsWithoutAToast', () => {
    service.notify({ severity: 'success', title: 'Quiet', route: 'history-only' });

    expect(service.toasts().length).toBe(0);
    expect(service.history().length).toBe(1);
    expect(service.unseenCount()).toBe(1);
  });

  it('notify_whenRoutedToastOnly_toastsWithoutARecord', () => {
    service.notify({ severity: 'info', title: 'Ephemeral', route: 'toast-only' });

    expect(service.toasts().length).toBe(1);
    expect(service.history().length).toBe(0);
  });

  it('dismissByKey_whenAKeyedToastIsLive_removesIt', () => {
    service.notify({ severity: 'info', title: 'Ask', key: 'agent-ask:1', route: 'toast-only' });

    service.dismissByKey('agent-ask:1');

    expect(service.toasts().length).toBe(0);
  });

  it('dismissByKey_whenNoToastCarriesTheKey_leavesTheStackAlone', () => {
    service.notify({ severity: 'info', title: 'Other' });

    service.dismissByKey('agent-ask:missing');

    expect(service.toasts().length).toBe(1);
  });

  it('clearAll_whenCalled_emptiesTheHistoryAndTheStack', () => {
    service.notify({ severity: 'info', title: 'A' });
    service.notify({ severity: 'error', title: 'B' });

    service.clearAll();

    expect(service.history().length).toBe(0);
    expect(service.toasts().length).toBe(0);
    expect(service.unseenCount()).toBe(0);
  });
});
