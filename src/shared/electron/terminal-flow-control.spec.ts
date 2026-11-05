import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACKNOWLEDGEMENT_TIMEOUT_MS,
  HIGH_WATERMARK,
  LOW_WATERMARK,
  TerminalFlowControl,
} from './terminal-flow-control';
import { TerminalFlowControlTarget } from './terminal-flow-control-target';

/**
 * Records what a session was told, in order.
 */
class FakePty implements TerminalFlowControlTarget {
  /**
   * Holds the calls received.
   */
  public readonly calls: string[] = [];

  /**
   * Records a pause.
   */
  public pause(): void {
    this.calls.push('pause');
  }

  /**
   * Records a resume.
   */
  public resume(): void {
    this.calls.push('resume');
  }
}

describe('TerminalFlowControl', () => {
  let flow: TerminalFlowControl;
  let session: FakePty;

  beforeEach(() => {
    vi.useFakeTimers();
    flow = new TerminalFlowControl();
    session = new FakePty();
    flow.track('t', session);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Proves a pane is reading, as its first parsed chunk does.
   */
  function attach(): void {
    flow.acknowledge('t', 0);
  }

  it('sent_withNoPaneEverAcknowledging_neverPauses', () => {
    // A detached session records to the scrollback and must run on: pausing it would stop it for good.
    flow.sent('t', HIGH_WATERMARK * 100);

    expect(session.calls).toEqual([]);
  });

  it('sent_upToTheHighWatermark_doesNotPause', () => {
    attach();

    flow.sent('t', HIGH_WATERMARK);

    expect(session.calls).toEqual([]);
  });

  it('sent_pastTheHighWatermark_pausesOnce', () => {
    attach();

    flow.sent('t', HIGH_WATERMARK + 1);
    flow.sent('t', HIGH_WATERMARK);

    expect(session.calls).toEqual(['pause']);
  });

  it('acknowledge_aboveTheLowWatermark_staysPaused', () => {
    attach();
    flow.sent('t', HIGH_WATERMARK + 1);

    flow.acknowledge('t', HIGH_WATERMARK + 1 - LOW_WATERMARK - 1);

    expect(session.calls).toEqual(['pause']);
  });

  it('acknowledge_downToTheLowWatermark_resumesOnce', () => {
    attach();
    flow.sent('t', HIGH_WATERMARK + 1);

    flow.acknowledge('t', HIGH_WATERMARK + 1 - LOW_WATERMARK);
    flow.acknowledge('t', LOW_WATERMARK);

    expect(session.calls).toEqual(['pause', 'resume']);
  });

  it('acknowledge_ofMoreThanWasSent_cannotBankCredit', () => {
    // An untrusted figure from the renderer: over-acknowledging must not disable the limit.
    attach();
    flow.acknowledge('t', HIGH_WATERMARK * 10);

    flow.sent('t', HIGH_WATERMARK + 1);

    expect(session.calls).toEqual(['pause']);
  });

  it('outputSentBeforeAPaneAttached_isNotWaitedFor', () => {
    flow.sent('t', HIGH_WATERMARK * 3);

    attach();
    flow.sent('t', HIGH_WATERMARK);

    expect(session.calls).toEqual([]);
  });

  it('watchdog_whenAcknowledgementsStop_resumesTheSession', () => {
    attach();
    flow.sent('t', HIGH_WATERMARK + 1);

    vi.advanceTimersByTime(ACKNOWLEDGEMENT_TIMEOUT_MS);

    expect(session.calls).toEqual(['pause', 'resume']);
  });

  it('watchdog_afterItFires_leavesTheSessionUnpausedUntilAPaneReturns', () => {
    attach();
    flow.sent('t', HIGH_WATERMARK + 1);
    vi.advanceTimersByTime(ACKNOWLEDGEMENT_TIMEOUT_MS);

    flow.sent('t', HIGH_WATERMARK * 2);
    expect(session.calls).toEqual(['pause', 'resume']);

    attach();
    flow.sent('t', HIGH_WATERMARK + 1);
    expect(session.calls).toEqual(['pause', 'resume', 'pause']);
  });

  it('watchdog_withASlowButLivePane_waitsFromTheLatestAcknowledgement', () => {
    attach();
    flow.sent('t', HIGH_WATERMARK * 2);

    vi.advanceTimersByTime(ACKNOWLEDGEMENT_TIMEOUT_MS - 1);
    flow.acknowledge('t', 1);
    vi.advanceTimersByTime(ACKNOWLEDGEMENT_TIMEOUT_MS - 1);

    expect(session.calls).toEqual(['pause']);
  });

  it('watchdog_afterAResume_doesNotFireAgain', () => {
    attach();
    flow.sent('t', HIGH_WATERMARK + 1);
    flow.acknowledge('t', HIGH_WATERMARK + 1);

    vi.advanceTimersByTime(ACKNOWLEDGEMENT_TIMEOUT_MS * 2);

    expect(session.calls).toEqual(['pause', 'resume']);
  });

  it('forget_whilePaused_leavesNoTimerToTouchADeadSession', () => {
    attach();
    flow.sent('t', HIGH_WATERMARK + 1);

    flow.forget('t');
    vi.advanceTimersByTime(ACKNOWLEDGEMENT_TIMEOUT_MS * 2);

    expect(session.calls).toEqual(['pause']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('track_underAReusedId_startsClean_andDropsThePredecessorsTimer', () => {
    attach();
    flow.sent('t', HIGH_WATERMARK + 1);
    const successor: FakePty = new FakePty();

    flow.track('t', successor);
    vi.advanceTimersByTime(ACKNOWLEDGEMENT_TIMEOUT_MS * 2);
    flow.sent('t', HIGH_WATERMARK * 2);

    expect(session.calls).toEqual(['pause']);
    expect(successor.calls).toEqual([]);
  });

  it('calls_forAnUnknownSession_doNothing', () => {
    expect(() => {
      flow.sent('nobody', 1);
      flow.acknowledge('nobody', 1);
      flow.forget('nobody');
    }).not.toThrow();
  });
});
