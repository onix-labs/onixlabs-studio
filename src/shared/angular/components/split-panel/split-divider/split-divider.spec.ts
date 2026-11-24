import { Component, Signal, signal, viewChildren, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SplitDirection } from '../split-direction';
import { SplitPane } from '../split-pane/split-pane';
import { SplitPanel } from '../split-panel/split-panel';
import { SplitDivider } from './split-divider';

/**
 * Hosts a split of three panes, 800 pixels along, and records what it reports.
 */
@Component({
  imports: [SplitPanel, SplitPane, SplitDivider],
  template: `
    @if (split()) {
      <app-split-panel
        [dir]="dir()"
        (resizeStart)="events.push('start')"
        (resizeEnd)="events.push('end')"
        (sharesChange)="onShares($event)"
      >
        <app-split-pane [share]="shares()[0]" [minSize]="minimum()" />
        @if (divider()) {
          <app-split-divider [locked]="locked()" />
        }
        <app-split-pane [share]="shares()[1]" />
        @if (third()) {
          <app-split-divider />
          <app-split-pane [share]="shares()[2]" />
        }
      </app-split-panel>
    }
  `,
})
class TestHost {
  public readonly split: WritableSignal<boolean> = signal<boolean>(true);
  public readonly divider: WritableSignal<boolean> = signal<boolean>(true);
  public readonly third: WritableSignal<boolean> = signal<boolean>(true);
  public readonly locked: WritableSignal<boolean> = signal<boolean>(false);
  public readonly minimum: WritableSignal<number> = signal<number>(0);
  public readonly dir: WritableSignal<SplitDirection> = signal<SplitDirection>('row');
  public readonly shares: WritableSignal<readonly number[]> = signal<readonly number[]>([1, 1, 2]);
  public readonly events: string[] = [];

  public onShares(shares: readonly number[]): void {
    this.events.push('shares');
    this.shares.set(shares);
  }
}

/**
 * Hosts a split with a pane sized in pixels at each end and one sized by share between them.
 */
@Component({
  imports: [SplitPanel, SplitPane, SplitDivider],
  template: `
    <app-split-panel dir="row" (sharesChange)="shares = shares + 1">
      <app-split-pane
        [defaultSize]="200"
        [minSize]="100"
        [maxSize]="300"
        [visible]="first()"
        [resizable]="resizable()"
      />
      <app-split-divider />
      <app-split-pane [minSize]="150" [visible]="middle()" />
      <app-split-divider />
      <app-split-pane [defaultSize]="200" [minSize]="100" [visible]="last()" />
    </app-split-panel>
  `,
})
class SizedHost {
  public readonly first: WritableSignal<boolean> = signal<boolean>(true);
  public readonly middle: WritableSignal<boolean> = signal<boolean>(true);
  public readonly last: WritableSignal<boolean> = signal<boolean>(true);
  public readonly resizable: WritableSignal<boolean> = signal<boolean>(true);
  public readonly panes: Signal<readonly SplitPane[]> = viewChildren<SplitPane>(SplitPane);
  public shares: number = 0;

  /**
   * Gets every pane's size.
   * @returns Returns the sizes in pixels, null for one sized by share.
   */
  public sizes(): readonly (number | null)[] {
    return this.panes().map((pane: SplitPane): number | null => pane.size());
  }
}

describe('SplitDivider', () => {
  let fixture: ComponentFixture<TestHost>;
  let host: TestHost;

  /**
   * Finds the split's rendered dividers.
   * @returns Returns the dividers, in order.
   */
  function dividers(): readonly HTMLElement[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('app-split-divider'),
    ];
  }

  /**
   * Finds the split's rendered panes.
   * @returns Returns the panes, in order.
   */
  function panes(): readonly HTMLElement[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('app-split-pane'),
    ];
  }

  /**
   * Presses a divider at the origin.
   * @param index The divider's index.
   */
  function press(index: number = 0): void {
    dividers()[index].dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }),
    );
  }

  /**
   * Moves the pointer.
   * @param x The horizontal position.
   * @param y The vertical position.
   */
  function move(x: number, y: number = 0): void {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
  }

  /**
   * Releases the pointer.
   */
  function release(): void {
    document.dispatchEvent(new MouseEvent('mouseup'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();
    fixture = TestBed.createComponent(TestHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
    const panel: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'app-split-panel',
    )!;
    panel.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 800, 400);
  });

  afterEach(() => {
    release();
  });

  it('render_whenRow_isAVerticalSeparator', () => {
    expect(dividers()[0].classList.contains('split-divider--row')).toBe(true);
    expect(dividers()[0].getAttribute('role')).toBe('separator');
    expect(dividers()[0].getAttribute('aria-orientation')).toBe('vertical');
  });

  it('render_whenColumn_isAHorizontalSeparator', () => {
    host.dir.set('col');
    fixture.detectChanges();

    expect(dividers()[0].classList.contains('split-divider--col')).toBe(true);
    expect(dividers()[0].getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('drag_whileMoving_sizesThePairLiveAndReportsNothing', () => {
    press();
    move(100);

    expect(panes()[0].style.flexGrow).toBe('1.5');
    expect(panes()[1].style.flexGrow).toBe('0.5');
    expect(host.events).toEqual(['start']);
  });

  it('drag_whenReleased_endsThenReportsEveryPanesShare', () => {
    press();
    move(100);
    release();

    expect(host.events).toEqual(['start', 'end', 'shares']);
    expect(host.shares()).toEqual([1.5, 0.5, 2]);
  });

  it('drag_whenColumn_followsTheVerticalAxis', () => {
    host.dir.set('col');
    fixture.detectChanges();

    press();
    move(300, 50);
    release();

    expect(host.shares()).toEqual([1.5, 0.5, 2]);
  });

  it('drag_onALaterDivider_resizesThePairBesideIt', () => {
    press(1);
    move(100);
    release();

    expect(host.shares()).toEqual([1, 1.5, 1.5]);
  });

  it('drag_pastThePanesMinimum_stopsAtIt', () => {
    host.minimum.set(150);
    fixture.detectChanges();

    press();
    move(-500);
    release();

    expect(host.shares()).toEqual([0.75, 1.25, 2]);
  });

  it('drag_whenNoMinimumIsGiven_stopsAtTheFloor', () => {
    press();
    move(500);
    release();

    // The pair's 400 pixels, less the 36 the second pane keeps.
    expect(host.shares()[0]).toBeCloseTo(1.82);
  });

  it('drag_whenThePairIsTooSmallForBothMinimums_holdsStill', () => {
    host.minimum.set(390);
    fixture.detectChanges();

    press();
    move(-100);
    release();

    expect(host.shares()).toEqual([1, 1, 2]);
  });

  it('press_whenLocked_doesNothing', () => {
    host.locked.set(true);
    fixture.detectChanges();

    press();
    move(100);
    release();

    expect(dividers()[0].classList.contains('split-divider--disabled')).toBe(true);
    expect(host.events).toEqual([]);
  });

  it('drag_whenTheDividerGoes_endsWithoutReportingAndRestoresThePanes', () => {
    press();
    move(100);
    host.divider.set(false);
    fixture.detectChanges();
    release();

    expect(host.events).toEqual(['start', 'end']);
    expect(panes()[0].style.flexGrow).toBe('1');
  });

  it('drag_whenTheWholeSplitGoes_stillEnds', () => {
    press();
    move(100);
    host.split.set(false);
    fixture.detectChanges();

    expect((): void => release()).not.toThrow();
    expect(host.events).toEqual(['start', 'end']);
  });

  it('drag_whenAnotherPaneGoes_reportsNothing', () => {
    press();
    move(100);
    host.third.set(false);
    fixture.detectChanges();
    release();

    expect(host.events).toEqual(['start', 'end']);
    expect(panes()[0].style.flexGrow).toBe('1');
  });

  it('press_whileAlreadyDragging_startsAfresh', () => {
    press();
    move(100);
    press();
    release();

    expect(host.events).toEqual(['start', 'end', 'start', 'end', 'shares']);
    expect(host.shares()).toEqual([1, 1, 2]);
  });

  describe('beside panes sized in pixels', () => {
    let sized: ComponentFixture<SizedHost>;

    /**
     * Finds the rendered dividers.
     * @returns Returns the dividers, in order.
     */
    function handles(): readonly HTMLElement[] {
      return [
        ...(sized.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('app-split-divider'),
      ];
    }

    /**
     * Gives the split a width of 1000 and the panes the widths a browser would.
     * @param widths The panes' widths.
     */
    function layOut(widths: readonly number[]): void {
      const element: HTMLElement = sized.nativeElement as HTMLElement;
      element.querySelector<HTMLElement>('app-split-panel')!.getBoundingClientRect = (): DOMRect =>
        new DOMRect(0, 0, 1000, 500);
      element
        .querySelectorAll<HTMLElement>('app-split-pane')
        .forEach((pane: HTMLElement, index: number): void => {
          pane.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, widths[index], 500);
        });
    }

    /**
     * Drags a divider and releases it.
     * @param index The divider's index.
     * @param by How far, in pixels.
     */
    function dragBy(index: number, by: number): void {
      handles()[index].dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0 }),
      );
      move(by);
      release();
      sized.detectChanges();
    }

    beforeEach(() => {
      sized = TestBed.createComponent(SizedHost);
      sized.detectChanges();
      layOut([200, 600, 200]);
    });

    it('drag_afterASizedPane_changesItsSizeAndNoShares', () => {
      dragBy(0, 50);

      expect(sized.componentInstance.sizes()).toEqual([250, null, 200]);
      expect(sized.componentInstance.shares).toBe(0);
    });

    it('drag_beforeASizedPane_changesItTheOtherWay', () => {
      dragBy(1, 50);

      expect(sized.componentInstance.sizes()).toEqual([200, null, 150]);
    });

    it('drag_pastTheMaximum_stopsAtIt', () => {
      dragBy(0, 500);

      expect(sized.componentInstance.sizes()[0]).toBe(300);
    });

    it('drag_pastTheMinimum_stopsAtIt', () => {
      dragBy(0, -500);

      expect(sized.componentInstance.sizes()[0]).toBe(100);
    });

    it('drag_intoThePaneSizedByShare_leavesItItsMinimum', () => {
      layOut([200, 200, 200]);

      dragBy(0, 90);

      expect(sized.componentInstance.sizes()[0]).toBe(250);
    });

    it('press_withoutMoving_setsNothing', () => {
      // Held back to 160 by the room there is, and to be 200 again when there is more.
      layOut([160, 600, 200]);

      dragBy(0, 0);

      expect(sized.componentInstance.sizes()[0]).toBe(200);
    });

    it('press_whenAPaneIsNotResizable_doesNothing', () => {
      sized.componentInstance.resizable.set(false);
      sized.detectChanges();

      dragBy(0, 50);

      expect(sized.componentInstance.sizes()[0]).toBe(200);
      expect(handles()[0].classList.contains('split-divider--disabled')).toBe(true);
      expect(handles()[1].classList.contains('split-divider--disabled')).toBe(false);
    });

    it('render_whenAnEndPaneIsHidden_hidesItsDivider', () => {
      sized.componentInstance.last.set(false);
      sized.detectChanges();

      expect(handles()[0].classList.contains('split-divider--hidden')).toBe(false);
      expect(handles()[1].classList.contains('split-divider--hidden')).toBe(true);
    });

    it('render_whenAMiddlePaneIsHidden_leavesOneDividerBetweenItsNeighbours', () => {
      sized.componentInstance.middle.set(false);
      sized.detectChanges();

      expect(handles()[0].classList.contains('split-divider--hidden')).toBe(false);
      expect(handles()[1].classList.contains('split-divider--hidden')).toBe(true);
    });

    it('drag_betweenTwoSizedPanes_tradesBetweenThem', () => {
      sized.componentInstance.middle.set(false);
      sized.detectChanges();

      dragBy(0, 60);

      expect(sized.componentInstance.sizes()).toEqual([260, null, 140]);
    });

    it('drag_whenAPaneIsHiddenUnderThePointer_setsNothing', () => {
      handles()[0].dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0 }),
      );
      move(50);
      sized.componentInstance.middle.set(false);
      sized.detectChanges();
      release();

      expect(sized.componentInstance.sizes()).toEqual([200, null, 200]);
      expect(sized.componentInstance.panes()[0].element.style.flexBasis).toBe('200px');
    });
  });

  it('drag_betweenShares_leavesOutTheRoomASizedPaneTakes', () => {
    @Component({
      imports: [SplitPanel, SplitPane, SplitDivider],
      template: `
        <app-split-panel dir="row" (sharesChange)="shares = $event">
          <app-split-pane [defaultSize]="200" />
          <app-split-pane />
          <app-split-divider />
          <app-split-pane />
        </app-split-panel>
      `,
    })
    class MixedHost {
      public shares: readonly number[] = [];
    }
    const mixed: ComponentFixture<MixedHost> = TestBed.createComponent(MixedHost);
    mixed.detectChanges();
    const element: HTMLElement = mixed.nativeElement as HTMLElement;
    element.querySelector<HTMLElement>('app-split-panel')!.getBoundingClientRect = (): DOMRect =>
      new DOMRect(0, 0, 1000, 500);
    element.querySelector<HTMLElement>('app-split-pane')!.getBoundingClientRect = (): DOMRect =>
      new DOMRect(0, 0, 200, 500);

    element
      .querySelector('app-split-divider')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0 }));
    move(100);
    release();

    // 800 pixels shared between two: 100 of them is a quarter of a share.
    expect(mixed.componentInstance.shares).toEqual([1, 1.25, 0.75]);
  });
});
