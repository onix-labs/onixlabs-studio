import { beforeEach, describe, expect, it } from 'vitest';
import { Component, Signal, TemplateRef, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MODAL_WINDOW_CONFIG, ModalWindowHost } from './modal-window-host';

/**
 * Declares the content template the host is configured with. Separate from the host so the template
 * exists before the host is constructed, which is the order the real window mounts them in.
 */
@Component({
  template: `<ng-template #content><p>content</p></ng-template>`,
})
class TemplateDeclarer {
  public readonly template: Signal<TemplateRef<unknown>> =
    viewChild.required<TemplateRef<unknown>>('content');
}

describe('ModalWindowHost', () => {
  /**
   * The config the host injects. Mutable so the template can be filled in once the declarer has
   * rendered, without tearing down the module the host is about to be created in.
   */
  let config: { document: Document; content: TemplateRef<unknown> | null; fill: boolean };

  beforeEach(() => {
    config = { document, content: null, fill: false };
    TestBed.configureTestingModule({
      providers: [{ provide: MODAL_WINDOW_CONFIG, useValue: config }],
    });
    const declarer: ComponentFixture<TemplateDeclarer> = TestBed.createComponent(TemplateDeclarer);
    declarer.detectChanges();
    config.content = declarer.componentInstance.template();
  });

  /**
   * States the content wrapper's measurements, standing in for a layout jsdom does not perform.
   * @param scrollHeight The integer `scrollHeight` the engine would report.
   * @param rectHeight The fractional height the bounding rect would report.
   * @returns Returns the measured height the window would be fitted to.
   */
  function measureWith(scrollHeight: number, rectHeight: number): number {
    const fixture: ComponentFixture<ModalWindowHost> = TestBed.createComponent(ModalWindowHost);
    fixture.detectChanges();
    const content: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector(
      '.modal-window-host__content',
    )!;
    Object.defineProperty(content, 'scrollHeight', { value: scrollHeight, configurable: true });
    content.getBoundingClientRect = (): DOMRect => ({ height: rectHeight }) as DOMRect;
    return fixture.componentInstance.measure();
  }

  it('measure_neverReportsLessThanTheContentOccupies', () => {
    // The bug this guards: `scrollHeight` is an integer rounded from a layout height that rarely is
    // one, so a column of rem gaps rounds *down* and the panel is left a sliver short — a scrollbar
    // over a gap too small to see.
    expect(measureWith(300, 300.4)).toBeGreaterThanOrEqual(300.4);
    expect(measureWith(300, 300.6)).toBeGreaterThanOrEqual(300.6);
  });

  it('measure_roundsUpRatherThanToNearest', () => {
    expect(measureWith(300, 300.4)).toBe(301);
  });

  it('measure_takesTheLargerOfTheTwoMeasurements', () => {
    // They answer different questions: the rect is this box, `scrollHeight` also covers a child that
    // overflows it. Whichever is larger is the one that has to fit.
    expect(measureWith(420, 300.4)).toBe(420);
  });

  it('measure_withNothingLaidOut_reportsNothing', () => {
    // A measurement of nothing is content that has not been laid out, not a dialog wanting no height;
    // the modal leaves the window alone rather than collapsing it.
    expect(measureWith(0, 0)).toBe(0);
  });
});
