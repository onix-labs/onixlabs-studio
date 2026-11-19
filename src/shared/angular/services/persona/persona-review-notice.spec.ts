import { TestBed } from '@angular/core/testing';
import type { Bridge } from '@shared/api/bridge';
import { PeteChannel, type PersonaChange, type PeteState } from '@shared/api/pete-protocol';
import { AiManagerNavigation } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { CoreNotificationType } from '@shared/angular/services/notifications/core-notification-types';
import type { Notification } from '@shared/angular/services/notifications/notifications';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Pete, type PeteRunSummary } from './pete';
import { PersonaReviewNotice } from './persona-review-notice';

/**
 * A change waiting for review.
 * @param id The id.
 * @returns Returns the change.
 */
function waiting(id: string): PersonaChange {
  return { id, at: 0, kind: 'remove', entryId: id, before: null, after: null, reason: '' };
}

describe('PersonaReviewNotice (#1517)', () => {
  let state: PeteState;
  let opened: string[];
  let finished: (summary: PeteRunSummary) => void;

  beforeEach(() => {
    opened = [];
    state = { recent: [], pending: [], ruledOut: [], questions: [], lastRun: 0 };
    const bridge: Partial<Bridge> = {
      invoke: <T>(channel: string): Promise<T> =>
        Promise.resolve((channel === (PeteChannel.State as string) ? state : undefined) as T),
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge?: Partial<Bridge> }).bridge = bridge;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AiManagerNavigation,
          useValue: { open: (section: string): number => opened.push(section) },
        },
      ],
    });
    const pete: Pete = TestBed.inject(Pete);
    const listen: Pete['onFinished'] = pete.onFinished.bind(pete);
    Reflect.set(pete, 'onFinished', (listener: (summary: PeteRunSummary) => void): (() => void) => {
      finished = listener;
      return listen(listener);
    });
    TestBed.inject(PersonaReviewNotice);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  /**
   * Reports a run.
   * @param pending How many changes it left waiting.
   * @returns Resolves once the notice has had its chance.
   */
  async function run(pending: number): Promise<void> {
    finished({ applied: 0, pending, refused: 0, messagesRead: 1, error: null });
    for (let tick: number = 0; tick < 5; tick += 1) {
      await Promise.resolve();
    }
  }

  it('saysNothing_whenNothingWaits', async () => {
    await run(0);

    expect(TestBed.inject(Notifications).toasts()).toEqual([]);
  });

  it('raisesOneNotification_thatALaterRunUpdatesInPlace', async () => {
    state = { ...state, pending: [waiting('a')] };
    await run(1);
    state = { ...state, pending: [waiting('a'), waiting('b'), waiting('c')] };
    await run(2);

    const toasts: readonly Notification[] = TestBed.inject(Notifications).toasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      title: 'Pete has persona changes for you to review',
      type: CoreNotificationType.PersonaReview,
    });
    expect(toasts[0].detail).toContain('3 changes');
  });

  it('review_opensThePersonaAndTheReview', async () => {
    state = { ...state, pending: [waiting('a')] };
    await run(1);

    TestBed.inject(Notifications).toasts()[0].actions[0].run();

    expect(opened).toEqual(['persona']);
    expect(TestBed.inject(Pete).reviewOpen()).toBe(true);
  });
});
