import { Component, signal, WritableSignal } from '@angular/core';
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
});
