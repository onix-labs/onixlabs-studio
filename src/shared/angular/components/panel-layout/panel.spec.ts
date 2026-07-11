import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PANEL_LAYOUT_CONTEXT, PanelLayoutContext } from './panel-layout-context';
import { clampPanelWidth, PanelArrangement, PanelEdge } from './panel-types';
import { Panel } from './panel';

/**
 * A controllable layout context standing in for the owning {@link PanelLayout}, so the panel's
 * placement, flex share, and divider behaviour can be driven directly.
 */
class StubLayoutContext implements PanelLayoutContext {
  public readonly arrangement: WritableSignal<PanelArrangement> = signal<PanelArrangement>({});
  public readonly shares: WritableSignal<Readonly<Record<string, number>>> = signal<
    Readonly<Record<string, number>>
  >({});
  public readonly activeDivider: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the visible stack returned for every edge, signal-backed so computeds that call
   * {@link visibleStack} re-evaluate when it changes.
   */
  public readonly stack: WritableSignal<readonly string[]> = signal<readonly string[]>(['alpha']);

  /**
   * Records the panel ids whose divider drags were started.
   */
  public readonly dividerDrags: string[] = [];

  public visibleStack(): readonly string[] {
    return this.stack();
  }

  public beginDividerDrag(panelId: string): void {
    this.dividerDrags.push(panelId);
  }
}

@Component({
  imports: [Panel],
  template: `
    <app-panel panelId="alpha" [defaultEdge]="defaultEdge()" [visible]="visible()">
      <div class="probe">content</div>
    </app-panel>
  `,
})
class TestHost {
  public readonly defaultEdge: WritableSignal<PanelEdge> = signal<PanelEdge>('right');
  public readonly visible: WritableSignal<boolean> = signal<boolean>(true);
}

describe('Panel', () => {
  let fixture: ComponentFixture<TestHost>;
  let context: StubLayoutContext;
  let host: HTMLElement;

  beforeEach(async () => {
    context = new StubLayoutContext();
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [{ provide: PANEL_LAYOUT_CONTEXT, useValue: context }],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  /**
   * Gets the panel's host element.
   * @returns Returns the `app-panel` element.
   */
  function panelElement(): HTMLElement {
    return host.querySelector<HTMLElement>('app-panel')!;
  }

  it('placement_whenNothingStored_usesDeclaredDefaultsAndProjectsContent', () => {
    const element: HTMLElement = panelElement();
    const expectedWidth: number = clampPanelWidth(320, 120, 900, window.innerWidth);

    expect(element.getAttribute('data-edge')).toBe('right');
    expect(element.style.flex).toBe(`0 0 ${expectedWidth}px`);
    expect(element.querySelector('.probe')?.textContent).toContain('content');
    // The first (and only) member of its stack carries no leading divider.
    expect(element.querySelector('.panel__divider')).toBeNull();
  });

  it('placement_whenArrangementStoresThePanel_overridesTheDefaults', () => {
    context.arrangement.set({ alpha: { edge: 'left', order: 0, size: 200 } });
    fixture.detectChanges();

    const element: HTMLElement = panelElement();
    expect(element.getAttribute('data-edge')).toBe('left');
    expect(element.style.flex).toBe('0 0 200px');
  });

  it('flexValue_whenStoredWidthExceedsTheBounds_clampsIt', () => {
    context.arrangement.set({ alpha: { edge: 'right', order: 0, size: 5000 } });
    fixture.detectChanges();

    const expectedWidth: number = clampPanelWidth(5000, 120, 900, window.innerWidth);
    expect(panelElement().style.flex).toBe(`0 0 ${expectedWidth}px`);
  });

  it('flexValue_whenDockedToBottom_takesASharedShareTheContextCanOverride', () => {
    context.arrangement.set({ alpha: { edge: 'bottom', order: 0, size: 240 } });
    fixture.detectChanges();

    expect(panelElement().style.flex).toBe('1 1 0%');

    context.shares.set({ alpha: 2 });
    fixture.detectChanges();

    expect(panelElement().style.flex).toBe('2 2 0%');
  });

  it('flexValue_whenHidden_collapsesToAZeroTrackButKeepsContentMounted', () => {
    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();

    const element: HTMLElement = panelElement();
    expect(element.classList).toContain('panel--hidden');
    expect(element.style.flex).toBe('0 0 0%');
    expect(element.querySelector('.probe')).not.toBeNull();
  });

  it('divider_whenNotFirstInItsStack_isShownAndStartsADragOnMousedown', () => {
    context.stack.set(['other', 'alpha']);
    context.arrangement.set({ alpha: { edge: 'right', order: 1, size: 200 } });
    fixture.detectChanges();

    const divider: HTMLElement | null =
      panelElement().querySelector<HTMLElement>('.panel__divider');
    expect(divider).not.toBeNull();
    expect(divider!.getAttribute('aria-orientation')).toBe('vertical');

    divider!.dispatchEvent(new MouseEvent('mousedown'));

    expect(context.dividerDrags).toEqual(['alpha']);
  });
});
