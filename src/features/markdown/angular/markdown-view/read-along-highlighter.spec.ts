import { NgZone } from '@angular/core';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Reader } from '@features/markdown/angular/markdown-reader/markdown-reader';
import { ReadAlongHighlighter } from './read-along-highlighter';

/**
 * A zone stub that runs work synchronously, so publishes are observable in the test.
 */
const immediateZone: NgZone = { run: (work: () => void): void => work() } as unknown as NgZone;

describe('ReadAlongHighlighter', () => {
  let registerSession: (...args: unknown[]) => void;
  let unregisterSession: (...args: unknown[]) => void;
  let setDocument: (...args: unknown[]) => void;
  let reader: Reader;

  beforeEach((): void => {
    registerSession = vi.fn();
    unregisterSession = vi.fn();
    setDocument = vi.fn();
    reader = { registerSession, unregisterSession, setDocument } as unknown as Reader;
  });

  /**
   * Builds a highlighter over the fake reader and an absent pane/scroller.
   * @returns Returns the highlighter under test.
   */
  function highlighter(): ReadAlongHighlighter {
    return new ReadAlongHighlighter(
      (): MarkdownEditor | undefined => undefined,
      (): HTMLElement | null => null,
      immediateZone,
      reader,
    );
  }

  it('register_whenCalledTwice_registersOneSessionAndPublishesTheModel', () => {
    const subject: ReadAlongHighlighter = highlighter();

    subject.register();
    subject.register();

    expect(registerSession).toHaveBeenCalledTimes(1);
    expect(setDocument).toHaveBeenCalled();
  });

  it('unregister_whenRegistered_unregistersTheSession', () => {
    const subject: ReadAlongHighlighter = highlighter();

    subject.register();
    subject.unregister();

    expect(unregisterSession).toHaveBeenCalledTimes(1);
  });

  it('publishModel_whenNoSession_isANoOp', () => {
    const subject: ReadAlongHighlighter = highlighter();

    subject.publishModel();

    expect(setDocument).not.toHaveBeenCalled();
  });
});
