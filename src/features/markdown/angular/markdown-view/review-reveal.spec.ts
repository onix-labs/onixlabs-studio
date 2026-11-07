import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Review } from '@features/markdown/angular/markdown-review/markdown-review';
import {
  ReviewIssue,
  ReviewSession,
} from '@features/markdown/angular/markdown-review/review-types';
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

  /**
   * Registers a reveal and captures the session it hands the review service.
   * @param pane The editor pane.
   * @param scroller The editor's scroll container.
   * @returns Returns the registered session.
   */
  function sessionOver(pane: MarkdownEditor, scroller: HTMLElement | null): ReviewSession {
    let session: ReviewSession | undefined;
    const capturing: Review = {
      registerSession: (registered: ReviewSession): void => {
        session = registered;
      },
    } as unknown as Review;
    new ReviewReveal(
      (): MarkdownEditor => pane,
      (): HTMLElement | null => scroller,
      capturing,
    ).register();
    if (session === undefined) {
      throw new Error('Expected a session');
    }
    return session;
  }

  it('applyEdits_appliesEveryEditInOneReplacement', () => {
    const replaceAll: (markdown: string) => void = vi.fn();
    const pane: MarkdownEditor = {
      getMarkdown: (): string => 'helllo wrld helllo',
      replaceAll,
    } as unknown as MarkdownEditor;

    sessionOver(pane, null).applyEdits([
      { start: 0, end: 6, replacement: 'hello' },
      { start: 12, end: 18, replacement: 'hello' },
    ]);

    expect(replaceAll).toHaveBeenCalledTimes(1);
    expect(replaceAll).toHaveBeenCalledWith('hello wrld hello');
  });

  it('applyEdits_putsTheScrollPositionBack', () => {
    const scroller: HTMLElement = document.createElement('div');
    scroller.scrollTop = 120;
    const pane: MarkdownEditor = {
      getMarkdown: (): string => 'helllo',
      replaceAll: (): void => {
        scroller.scrollTop = 900;
      },
    } as unknown as MarkdownEditor;

    sessionOver(pane, scroller).applyEdits([{ start: 0, end: 6, replacement: 'hello' }]);

    expect(scroller.scrollTop).toBe(120);
  });

  it('undo_whenNoEditorView_isANoOp', () => {
    const pane: MarkdownEditor = {
      getEditorView: (): null => null,
    } as unknown as MarkdownEditor;

    expect((): void => sessionOver(pane, null).undo()).not.toThrow();
  });

  it('highlight_doesNotScrollTheEditor', () => {
    const root: HTMLElement = document.createElement('div');
    root.textContent = 'a helllo here';
    const scroller: HTMLElement = document.createElement('div');
    const scrollTo: () => void = vi.fn();
    scroller.scrollTo = scrollTo;
    const pane: MarkdownEditor = {
      getEditorView: (): { dom: HTMLElement } => ({ dom: root }),
      getMarkdown: (): string => 'a helllo here',
    } as unknown as MarkdownEditor;
    const session: ReviewSession = sessionOver(pane, scroller);
    const issue: ReviewIssue = {
      id: 'spelling:2:8',
      kind: 'spelling',
      ruleName: 'Unknown word',
      word: 'helllo',
      before: 'a ',
      after: ' here',
      start: 2,
      end: 8,
      suggestions: [],
    };

    session.highlight(issue);

    expect(scrollTo).not.toHaveBeenCalled();
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
