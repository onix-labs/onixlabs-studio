import { TestBed } from '@angular/core/testing';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { READ_ONLY_NOTICE_KEY, READ_ONLY_NOTICE_QUIET, ReadOnlyNotice } from './read-only-notice';

describe('ReadOnlyNotice (#1024)', () => {
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    notify = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: Notifications, useValue: { notify } }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('raisesABriefToastOnlyNotice_thatGoesByItself', () => {
    TestBed.inject(ReadOnlyNotice).show();

    expect(notify).toHaveBeenCalledExactlyOnceWith({
      severity: 'info',
      title: 'This editor is read-only',
      key: READ_ONLY_NOTICE_KEY,
      route: 'toast-only',
    });
  });

  it('aRunOfKeystrokes_raisesItOnce_andALaterAttemptAgain', () => {
    const notice: ReadOnlyNotice = TestBed.inject(ReadOnlyNotice);

    notice.show();
    vi.advanceTimersByTime(READ_ONLY_NOTICE_QUIET - 1);
    notice.show();
    notice.show();
    expect(notify).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    notice.show();
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
