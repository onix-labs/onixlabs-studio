import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CoalescedPointerMoves, coalescePointerMoves } from './pointer-coalesce';

/**
 * Builds a move event at the given coordinates.
 * @param x The client x coordinate.
 * @param y The client y coordinate.
 * @returns Returns the event.
 */
function moveAt(x: number, y: number): MouseEvent {
  return new MouseEvent('mousemove', { clientX: x, clientY: y });
}

describe('coalescePointerMoves', () => {
  /**
   * Holds the frame callbacks captured from the stubbed requestAnimationFrame, run by the test.
   */
  let frames: FrameRequestCallback[];

  /**
   * Holds the real requestAnimationFrame, restored after each test.
   */
  let realRaf: typeof requestAnimationFrame;

  beforeEach(() => {
    frames = [];
    realRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    };
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
  });

  /**
   * Runs the captured frame callbacks, as the next paint would.
   */
  function paint(): void {
    const pending: FrameRequestCallback[] = frames;
    frames = [];
    for (const frame of pending) {
      frame(0);
    }
  }

  it('runsTheFirstMoveSynchronously_andCoalescesTheFloodIntoOneTrailingRun', () => {
    const seen: number[] = [];
    const coalesced: CoalescedPointerMoves = coalescePointerMoves((event: MouseEvent): void => {
      seen.push(event.clientX);
    });

    coalesced.move(moveAt(1, 0));
    expect(seen).toEqual([1]);

    // A high-rate mouse floods several moves before the next frame; only the newest survives it.
    coalesced.move(moveAt(2, 0));
    coalesced.move(moveAt(3, 0));
    coalesced.move(moveAt(4, 0));
    expect(seen).toEqual([1]);
    paint();
    expect(seen).toEqual([1, 4]);
  });

  it('afterAQuietFrame_theNextMoveIsSynchronousAgain', () => {
    const seen: number[] = [];
    const coalesced: CoalescedPointerMoves = coalescePointerMoves((event: MouseEvent): void => {
      seen.push(event.clientX);
    });

    coalesced.move(moveAt(1, 0));
    paint();
    coalesced.move(moveAt(2, 0));
    expect(seen).toEqual([1, 2]);
  });

  it('flush_runsTheNewestUnprocessedMove_soAReleaseEndsWhereThePointerIs', () => {
    const seen: number[] = [];
    const coalesced: CoalescedPointerMoves = coalescePointerMoves((event: MouseEvent): void => {
      seen.push(event.clientX);
    });

    coalesced.move(moveAt(1, 0));
    coalesced.move(moveAt(2, 0));
    coalesced.flush();
    expect(seen).toEqual([1, 2]);

    // The trailing frame then finds nothing left to do.
    paint();
    expect(seen).toEqual([1, 2]);
    coalesced.flush();
    expect(seen).toEqual([1, 2]);
  });

  it('withoutRequestAnimationFrame_everyMoveProcessesSynchronously', () => {
    (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
      undefined as unknown as typeof requestAnimationFrame;
    const seen: number[] = [];
    const coalesced: CoalescedPointerMoves = coalescePointerMoves((event: MouseEvent): void => {
      seen.push(event.clientX);
    });

    coalesced.move(moveAt(1, 0));
    coalesced.move(moveAt(2, 0));
    expect(seen).toEqual([1, 2]);
  });
});
