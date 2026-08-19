import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DOCK_BLUEPRINT } from '../../../services/dock-layout/dock-blueprint';
import { TEST_DOCK_BLUEPRINT } from '../../../services/dock-layout/dock-test-blueprint';
import { DockAutoHide } from '../../../services/dock-layout/dock-auto-hide';
import { DockSide, StackNode } from '../../../services/dock-layout/dock-node';
import { DockState } from '../../../services/dock-layout/dock-state';
import { findStackOfPanel } from '../../../services/dock-layout/dock-tree';
import { DockCollapsedStrip } from './dock-collapsed-strip';

describe('DockCollapsedStrip', () => {
  let component: DockCollapsedStrip;
  let fixture: ComponentFixture<DockCollapsedStrip>;
  let autoHide: DockAutoHide;
  let state: DockState;

  /**
   * Collapses the stack holding the given panel and renders the strip for it.
   * @param panelId The panel whose stack to collapse and render.
   * @param side The edge the strip hugs.
   */
  function renderCollapsed(panelId: string, side: DockSide = 'left'): void {
    const stack: StackNode | null = findStackOfPanel(state.layout(), panelId);
    autoHide.pin(stack!.id, side);
    const collapsed: StackNode | null = findStackOfPanel(state.layout(), panelId);
    fixture.componentRef.setInput('stack', collapsed);
    fixture.componentRef.setInput('side', side);
    fixture.detectChanges();
  }

  /**
   * Pins the strip's host inside an ancestor that clips it, and gives both a fixed rectangle, so the
   * component measures the room a peek has the way it would against a real dock pane.
   * @param strip The rectangle the strip occupies.
   * @param clip The rectangle of the clipping ancestor.
   */
  function stubGeometry(strip: Partial<DOMRect>, clip: Partial<DOMRect>): void {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const ancestor: HTMLElement = host.parentElement!;
    ancestor.style.overflowX = 'hidden';
    ancestor.style.overflowY = 'hidden';
    host.getBoundingClientRect = (): DOMRect => strip as DOMRect;
    ancestor.getBoundingClientRect = (): DOMRect => clip as DOMRect;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockCollapsedStrip],
      providers: [{ provide: DOCK_BLUEPRINT, useValue: TEST_DOCK_BLUEPRINT }],
    }).compileComponents();

    fixture = TestBed.createComponent(DockCollapsedStrip);
    component = fixture.componentInstance;
    autoHide = TestBed.inject(DockAutoHide);
    state = TestBed.inject(DockState);
  });

  it('should create', () => {
    renderCollapsed('files');
    expect(component).toBeTruthy();
  });

  it('render_whenCollapsed_showsATabPerPanel', () => {
    renderCollapsed('files');

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const tab: HTMLButtonElement | null = element.querySelector<HTMLButtonElement>(
      '.dock-collapsed-strip__tab',
    );
    expect(tab?.textContent).toContain('File Explorer');
  });

  it('render_whenTabClicked_fliesTheStackOut', () => {
    renderCollapsed('output');

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.dock-collapsed-strip__tab')?.click();
    fixture.detectChanges();

    expect(element.querySelector('.dock-collapsed-strip__flyout')).not.toBeNull();
  });

  it('render_whenThePeekWouldOverrunTheSurfaceItOpensOver_shrinksItToFit', () => {
    // A bottom-hugging gutter with only 100px above it: the default 230px flyout would open past the
    // top of the pane that clips it and be invisible, so it opens at the room it has (less the gaps).
    renderCollapsed('output', 'bottom');
    stubGeometry(
      { top: 100, bottom: 130, left: 0, right: 500 },
      { top: 0, bottom: 400, left: 0, right: 500 },
    );

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.dock-collapsed-strip__tab')?.click();
    fixture.detectChanges();

    const flyout: HTMLElement | null = element.querySelector<HTMLElement>(
      '.dock-collapsed-strip__flyout',
    );
    expect(flyout?.style.blockSize).toBe('88px');
  });

  it('render_whenThereIsRoomForThePeek_leavesItAtItsFullSize', () => {
    renderCollapsed('output', 'bottom');
    stubGeometry(
      { top: 370, bottom: 400, left: 0, right: 500 },
      { top: 0, bottom: 400, left: 0, right: 500 },
    );

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.dock-collapsed-strip__tab')?.click();
    fixture.detectChanges();

    const flyout: HTMLElement | null = element.querySelector<HTMLElement>(
      '.dock-collapsed-strip__flyout',
    );
    expect(flyout?.style.blockSize).toBe('230px');
  });
});
