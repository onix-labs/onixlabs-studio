import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Review } from '@features/markdown/angular/markdown-review/markdown-review';
import { ReviewReveal } from './review-reveal';

describe('ReviewReveal', () => {
  let registerSession: (...args: unknown[]) => void;
  let unregisterSession: (...args: unknown[]) => void;
  let review: Review;

  beforeEach((): void => {
    registerSession = vi.fn();
    unregisterSession = vi.fn();
    review = { registerSession, unregisterSession } as unknown as Review;
  });

  /**
   * Builds a reveal over the fake review service and an absent pane/scroller.
   * @returns Returns the reveal under test.
   */
  function reveal(): ReviewReveal {
    return new ReviewReveal(
      (): MarkdownEditor | undefined => undefined,
      (): HTMLElement | null => null,
      review,
    );
  }

  it('register_whenCalledTwice_registersExactlyOneSession', () => {
    const subject: ReviewReveal = reveal();

    subject.register();
    subject.register();

    expect(registerSession).toHaveBeenCalledTimes(1);
  });

  it('unregister_whenRegistered_unregistersTheSession', () => {
    const subject: ReviewReveal = reveal();

    subject.register();
    subject.unregister();

    expect(unregisterSession).toHaveBeenCalledTimes(1);
  });

  it('unregister_whenNeverRegistered_isANoOp', () => {
    const subject: ReviewReveal = reveal();

    expect((): void => subject.unregister()).not.toThrow();
    expect(unregisterSession).not.toHaveBeenCalled();
  });

  it('segmentAt_findsTheLastSegmentAtOrBeforeAnOffset', () => {
    const dummy: Text = document.createTextNode('');
    const segments: readonly { node: Text; start: number }[] = [
      { node: dummy, start: 0 },
      { node: dummy, start: 5 },
      { node: dummy, start: 12 },
    ];
    const probe: {
      segmentAt(
        segments: readonly { node: Text; start: number }[],
        offset: number,
      ): { start: number } | undefined;
    } = reveal() as unknown as {
      segmentAt(
        segments: readonly { node: Text; start: number }[],
        offset: number,
      ): { start: number } | undefined;
    };

    expect(probe.segmentAt(segments, 7)?.start).toBe(5);
    expect(probe.segmentAt(segments, 0)?.start).toBe(0);
    expect(probe.segmentAt(segments, 100)?.start).toBe(12);
  });
});
