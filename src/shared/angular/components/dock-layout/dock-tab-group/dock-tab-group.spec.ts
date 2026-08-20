import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DOCK_BLUEPRINT } from '../../../services/dock-layout/dock-blueprint';
import { TEST_DOCK_BLUEPRINT } from '../../../services/dock-layout/dock-test-blueprint';
import { DockDrag } from '../../../services/dock-layout/dock-drag';
import { DockFloating } from '../../../services/dock-layout/dock-floating';
import { mkStack, StackNode } from '../../../services/dock-layout/dock-node';
import { DockPanelRegistry } from '../../../services/dock-layout/dock-panel-registry';
import { DockState } from '../../../services/dock-layout/dock-state';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanelPlaceholder } from '../dock-panel-placeholder/dock-panel-placeholder';
import { findStackOfPanel } from '../../../services/dock-layout/dock-tree';
import { DockTabGroup } from './dock-tab-group';

describe('DockTabGroup', () => {
  let component: DockTabGroup;
  let fixture: ComponentFixture<DockTabGroup>;
  let floating: DockFloating;
  let drag: DockDrag;

  /**
   * Renders the group for the given stack, registering it with the state so mutations resolve.
   * @param stack The stack to render.
   */
  function render(stack: StackNode): void {
    fixture.componentRef.setInput('stack', stack);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockTabGroup],
      providers: [{ provide: DOCK_BLUEPRINT, useValue: TEST_DOCK_BLUEPRINT }],
    }).compileComponents();

    fixture = TestBed.createComponent(DockTabGroup);
    component = fixture.componentInstance;
    floating = TestBed.inject(DockFloating);
    drag = TestBed.inject(DockDrag);
  });

  it('should create', () => {
    render(mkStack('tool', ['output']));
    expect(component).toBeTruthy();
  });

  it('render_whenToolRole_showsATitleBar', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.dock-tab-group__title')).not.toBeNull();
  });

  it('render_whenDocumentRole_omitsTheTitleBar', () => {
    render(mkStack('document', ['doc1']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.dock-tab-group__title')).toBeNull();
  });

  it('render_whenEmptyStack_rendersBlankWithNoContent', () => {
    render(mkStack('document', []));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.dock-tab-group__empty')).toBeNull();
    expect(element.querySelector('.dock-tab-group__tabstrip')).toBeNull();
    expect(element.querySelector('.dock-tab-group__body')).toBeNull();
  });

  it('requestFloat_whenFloatButtonClicked_floatsTheActivePanel', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const floatButton: HTMLButtonElement | null = element.querySelector<HTMLButtonElement>(
      'button[aria-label="Float"]',
    );
    floatButton?.click();

    expect(floating.floats().some((window): boolean => window.panelId === 'output')).toBe(true);
  });

  it('startDrag_whenTitleBarPressedAndDragged_startsACompassDragForTheActivePanel', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const title: HTMLElement | null = element.querySelector<HTMLElement>('.dock-tab-group__title');
    title?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60 }));

    expect(drag.panel()?.id).toBe('output');

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('startGroupDrag_whenTabRailPressedAndDragged_startsACompassDragForTheWholeGroup', () => {
    // The group must be the one the layout holds: a group drag moves a stack of the live tree.
    const stack: StackNode = findStackOfPanel(TestBed.inject(DockState).layout(), 'output')!;
    render(stack);

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const rail: HTMLElement | null = element.querySelector<HTMLElement>(
      '.dock-tab-group__tabstrip',
    );
    rail?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60 }));

    expect(drag.subject()).toEqual(
      expect.objectContaining({ kind: 'group', stackId: stack.id, count: stack.panels.length }),
    );

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('startGroupDrag_whenTheStackIsNotInTheLayout_startsNothing', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const rail: HTMLElement | null = element.querySelector<HTMLElement>(
      '.dock-tab-group__tabstrip',
    );
    rail?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60 }));

    expect(drag.active()).toBe(false);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('startGroupDrag_whenATabIsPressed_leavesTheTabsOwnDragToTheDropList', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const tab: HTMLElement | null = element.querySelector<HTMLElement>('.dock-tab');
    tab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60 }));

    expect(drag.active()).toBe(false);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('render_whenTheActiveDocumentOwnsItsToolStrip_theWellRendersNone', () => {
    // A request in the API well puts its own name and Send in the strip, so the dock must not draw
    // the editor-flavoured one above it.
    TestBed.inject(DockPanelRegistry).register({
      id: 'doc-with-strip',
      title: 'Request',
      icon: Icon.CODE,
      role: 'document',
      component: DockPanelPlaceholder,
      ownsToolStrip: true,
    });
    render(mkStack('document', ['doc-with-strip']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-dock-tool-strip')).toBeNull();
    // The frame's top edge moves onto the body, which would otherwise be drawn by that strip.
    expect(element.classList.contains('dock-tab-group--panel-strip')).toBe(true);
  });

  it('render_whenTheActiveDocumentHasNoStripOfItsOwn_theWellRendersOne', () => {
    TestBed.inject(DockPanelRegistry).register({
      id: 'plain-doc',
      title: 'File',
      icon: Icon.CODE,
      role: 'document',
      component: DockPanelPlaceholder,
    });
    render(mkStack('document', ['plain-doc']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-dock-tool-strip')).not.toBeNull();
    expect(element.classList.contains('dock-tab-group--panel-strip')).toBe(false);
  });

  it('render_whenStackHasAnActivePanel_marksTheActiveTab', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const tabs: NodeListOf<HTMLElement> = element.querySelectorAll<HTMLElement>('.dock-tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0].classList.contains('dock-tab--active')).toBe(true);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });
});
