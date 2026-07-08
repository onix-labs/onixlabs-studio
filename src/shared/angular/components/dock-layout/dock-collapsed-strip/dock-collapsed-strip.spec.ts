import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DOCK_BLUEPRINT } from '../../../services/dock-layout/dock-blueprint';
import { TEST_DOCK_BLUEPRINT } from '../../../services/dock-layout/dock-test-blueprint';
import { DockAutoHide } from '../../../services/dock-layout/dock-auto-hide';
import { StackNode } from '../../../services/dock-layout/dock-node';
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
   */
  function renderCollapsed(panelId: string): void {
    const stack: StackNode | null = findStackOfPanel(state.layout(), panelId);
    autoHide.pin(stack!.id);
    const collapsed: StackNode | null = findStackOfPanel(state.layout(), panelId);
    fixture.componentRef.setInput('stack', collapsed);
    fixture.componentRef.setInput('side', 'left');
    fixture.detectChanges();
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
});
