import { ErrorHandler, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FakeIntersectionObserver } from '@shared/angular/testing/fake-intersection-observer';
import { SPECIMEN_PAGES } from './agent-prompt-specimens';
import { CanvasRoot } from './canvas-root';
import type { SpecimenPage } from './specimen';

/**
 * Collects every error Angular reports while the canvas renders.
 */
class RecordingErrorHandler extends ErrorHandler {
  /**
   * Holds the errors reported.
   */
  public readonly errors: unknown[] = [];

  /**
   * Records an error.
   * @param error The error.
   */
  public override handleError(error: unknown): void {
    this.errors.push(error);
  }
}

// ⛔ The canvas's smoke test (#855). Its pages are only opened by hand, so a change that breaks one —
// most likely the conversation page, whose mock agent session is a cast the compiler cannot check —
// would otherwise go unnoticed until someone next looks, months later. Every page must render
// something, and nothing may throw while it does.
describe('Conversation canvas', () => {
  let observers: FakeIntersectionObserver;
  let errors: RecordingErrorHandler;

  beforeEach(() => {
    localStorage.clear();
    observers = FakeIntersectionObserver.install();
    errors = new RecordingErrorHandler();
    TestBed.configureTestingModule({ providers: [{ provide: ErrorHandler, useValue: errors }] });
  });

  afterEach(() => {
    observers.uninstall();
  });

  for (const page of SPECIMEN_PAGES) {
    it(`renders the ${page.title} page without errors`, async () => {
      const fixture: ComponentFixture<CanvasRoot> = TestBed.createComponent(CanvasRoot);
      (fixture.componentInstance as unknown as { pageTitle: WritableSignal<string> }).pageTitle.set(
        page.title,
      );
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement as HTMLElement;
      const frames: number = host.querySelectorAll('app-canvas-frame').length;
      expect(errors.errors).toEqual([]);
      expect(frames).toBe(framesFor(page));
      for (const frame of Array.from(host.querySelectorAll('app-canvas-frame'))) {
        // The frame's specimen is rendered beside it, as its sibling, by the view container.
        expect(frame.nextElementSibling).not.toBeNull();
      }
      if (page.layout === 'single') {
        expect(host.querySelectorAll('app-agent-chat').length).toBeGreaterThan(0);
        expect(host.querySelectorAll('.agent__messages > *').length).toBeGreaterThan(10);
      }
    });
  }
});

/**
 * Counts the frames a page draws in both themes: every state at each of the three widths, or each
 * specimen once.
 * @param page The page.
 * @returns Returns the count.
 */
function framesFor(page: SpecimenPage): number {
  const perTheme: number =
    page.layout === 'single'
      ? page.specimens.length
      : page.specimens.reduce((sum: number, specimen) => sum + specimen.states.length, 0) * 3;
  return perTheme * 2;
}
