import { Component, signal, viewChild, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SplitDirection } from '../split-direction';
import { SplitPane } from '../split-pane/split-pane';
import { SplitPanel } from './split-panel';

/**
 * Hosts a split whose first pane holds a split of its own.
 */
@Component({
  imports: [SplitPanel, SplitPane],
  template: `
    <app-split-panel #outer [dir]="dir()">
      <app-split-pane>
        <app-split-panel dir="col">
          <app-split-pane />
          <app-split-pane />
          <app-split-pane />
        </app-split-panel>
      </app-split-pane>
      @if (second()) {
        <app-split-pane [share]="2" />
      }
    </app-split-panel>
  `,
})
class TestHost {
  public readonly dir: WritableSignal<SplitDirection> = signal<SplitDirection>('row');
  public readonly second: WritableSignal<boolean> = signal<boolean>(true);
  public readonly outer: Signal<SplitPanel> = viewChild.required<SplitPanel>('outer');
}

/**
 * Hosts two splits of one kind, the second opened later, whose second panes remember their size.
 */
@Component({
  imports: [SplitPanel, SplitPane],
  template: `
    <app-split-panel dir="col" sizesKey="query">
      <app-split-pane />
      <app-split-pane #first paneId="results" [defaultSize]="200" />
    </app-split-panel>
    @if (later()) {
      <app-split-panel dir="col" sizesKey="query">
        <app-split-pane />
        <app-split-pane #second paneId="results" [defaultSize]="200" />
      </app-split-panel>
    }
  `,
})
class RememberingHost {
  public readonly later: WritableSignal<boolean> = signal<boolean>(false);
  public readonly first: Signal<SplitPane> = viewChild.required<SplitPane>('first');
  public readonly second: Signal<SplitPane | undefined> = viewChild<SplitPane>('second');
}

/**
 * Hosts a split whose second pane opens at a fraction of it.
 */
@Component({
  imports: [SplitPanel, SplitPane],
  template: `
    <app-split-panel dir="col">
      <app-split-pane />
      <app-split-pane #pane [defaultFraction]="0.4" [minSize]="120" [visible]="shown()" />
    </app-split-panel>
  `,
})
class FractionHost {
  public readonly shown: WritableSignal<boolean> = signal<boolean>(true);
  public readonly pane: Signal<SplitPane> = viewChild.required<SplitPane>('pane');
}

describe('SplitPanel', () => {
  let fixture: ComponentFixture<TestHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();
    fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
  });

  it('render_whenRow_carriesTheRowModifierClass', () => {
    const host: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector(
      'app-split-panel',
    )!;

    expect(host.classList.contains('split-panel--row')).toBe(true);
    expect(host.classList.contains('split-panel--col')).toBe(false);
  });

  it('render_whenTheDirectionChanges_followsIt', () => {
    fixture.componentInstance.dir.set('col');
    fixture.detectChanges();

    const host: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector(
      'app-split-panel',
    )!;
    expect(host.classList.contains('split-panel--col')).toBe(true);
  });

  it('panes_whenAPaneHoldsASplit_areItsOwnAndNotTheNestedOnes', () => {
    const shares: readonly number[] = fixture.componentInstance
      .outer()
      .panes()
      .map((pane: SplitPane): number => pane.share());

    expect(shares).toEqual([1, 2]);
  });

  it('panes_whenAPaneGoes_dropsIt', () => {
    fixture.componentInstance.second.set(false);
    fixture.detectChanges();

    expect(fixture.componentInstance.outer().panes().length).toBe(1);
  });

  describe('remembered sizes', () => {
    let remembering: ComponentFixture<RememberingHost>;

    beforeEach(() => {
      localStorage.clear();
      remembering = TestBed.createComponent(RememberingHost);
      remembering.detectChanges();
    });

    afterEach(() => localStorage.clear());

    it('open_whenNothingIsRemembered_takesTheDefault', () => {
      expect(remembering.componentInstance.first().size()).toBe(200);
    });

    it('open_afterASizeWasSetUnderTheKey_startsAtIt', () => {
      remembering.componentInstance.first().commitSize(340);
      remembering.componentInstance.later.set(true);
      remembering.detectChanges();

      expect(remembering.componentInstance.second()?.size()).toBe(340);
    });

    it('commit_inOneSplit_leavesOnesAlreadyOpenAlone', () => {
      remembering.componentInstance.later.set(true);
      remembering.detectChanges();

      remembering.componentInstance.first().commitSize(340);
      remembering.detectChanges();

      expect(remembering.componentInstance.second()?.size()).toBe(200);
    });
  });

  describe('a default fraction', () => {
    /**
     * Holds the observers created, so a test can say the pane has been measured.
     */
    let observers: (() => void)[];
    let original: typeof ResizeObserver;
    let hosted: ComponentFixture<FractionHost>;

    /**
     * Gives the split a height and tells every observer.
     * @param height The height in pixels.
     */
    function measure(height: number): void {
      const panel: HTMLElement = (hosted.nativeElement as HTMLElement).querySelector<HTMLElement>(
        'app-split-panel',
      )!;
      panel.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 900, height);
      for (const notify of observers) {
        notify();
      }
      hosted.detectChanges();
    }

    beforeEach(() => {
      observers = [];
      original = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        public constructor(callback: ResizeObserverCallback) {
          observers.push((): void => callback([], this));
        }
        public observe(): void {
          // Nothing is measured until a test says so.
        }
        public unobserve(): void {
          // As above.
        }
        public disconnect(): void {
          // As above.
        }
      };
      hosted = TestBed.createComponent(FractionHost);
      hosted.detectChanges();
    });

    afterEach(() => {
      globalThis.ResizeObserver = original;
    });

    it('measure_whenThereIsRoom_opensAtThatManyPixels', () => {
      measure(1000);

      expect(hosted.componentInstance.pane().size()).toBe(400);
    });

    it('measure_whenThereIsNone_waits', () => {
      measure(0);
      expect(hosted.componentInstance.pane().size()).toBeNull();

      measure(1000);
      expect(hosted.componentInstance.pane().size()).toBe(400);
    });

    it('measure_again_keepsTheSizeItOpenedAt', () => {
      measure(1000);
      measure(500);

      expect(hosted.componentInstance.pane().size()).toBe(400);
    });

    it('measure_whenTheFractionIsTooLittle_opensAtTheMinimum', () => {
      measure(200);

      expect(hosted.componentInstance.pane().size()).toBe(120);
    });

    it('measure_whileHidden_waitsToBeShown', () => {
      hosted.componentInstance.shown.set(false);
      hosted.detectChanges();
      measure(1000);
      expect(hosted.componentInstance.pane().size()).toBeNull();

      hosted.componentInstance.shown.set(true);
      hosted.detectChanges();
      measure(1000);
      expect(hosted.componentInstance.pane().size()).toBe(400);
    });
  });
});
