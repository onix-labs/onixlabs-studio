import { NgZone } from '@angular/core';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { MarkdownCommands } from '@shared/angular/services/markdown-commands/markdown-commands';
import { OutlineScrollSpy } from './outline-scroll-spy';

/**
 * A zone stub that runs work synchronously.
 */
const immediateZone: NgZone = { run: (work: () => void): void => work() } as unknown as NgZone;

describe('OutlineScrollSpy', () => {
  let commands: MarkdownCommands;

  beforeEach((): void => {
    commands = { setOutline: vi.fn(), setActiveHeading: vi.fn() } as unknown as MarkdownCommands;
  });

  /**
   * Builds a scroll-spy over an absent pane and an always-active gate.
   * @returns Returns the scroll-spy under test.
   */
  function scrollSpy(): OutlineScrollSpy {
    return new OutlineScrollSpy(
      (): MarkdownEditor | undefined => undefined,
      commands,
      immediateZone,
      (): boolean => true,
    );
  }

  it('attach_whenCalled_addsAPassiveScrollListener', () => {
    const scroller: HTMLDivElement = document.createElement('div');
    const add: (...args: unknown[]) => void = vi.fn();
    scroller.addEventListener = add;

    scrollSpy().attach(scroller);

    expect(add).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
  });

  it('detach_whenAttached_removesTheScrollListener', () => {
    const scroller: HTMLDivElement = document.createElement('div');
    const remove: (...args: unknown[]) => void = vi.fn();
    scroller.removeEventListener = remove;
    const spy: OutlineScrollSpy = scrollSpy();

    spy.attach(scroller);
    spy.detach();

    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('attach_whenCalledAgain_detachesTheFirstScroller', () => {
    const first: HTMLDivElement = document.createElement('div');
    const remove: (...args: unknown[]) => void = vi.fn();
    first.removeEventListener = remove;
    const second: HTMLDivElement = document.createElement('div');
    const spy: OutlineScrollSpy = scrollSpy();

    spy.attach(first);
    spy.attach(second);

    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('goToHeading_whenNotAttached_isANoOp', () => {
    expect((): void => scrollSpy().goToHeading(0)).not.toThrow();
  });
});
