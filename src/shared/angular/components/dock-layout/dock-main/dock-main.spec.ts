import { Component, DestroyRef, inject, input, InputSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockAutoHide } from '../../../services/dock-layout/dock-auto-hide';
import { DOCK_BLUEPRINT, DockBlueprint } from '../../../services/dock-layout/dock-blueprint';
import { DockDrag } from '../../../services/dock-layout/dock-drag';
import { DockFloating } from '../../../services/dock-layout/dock-floating';
import { DockFocus } from '../../../services/dock-layout/dock-focus';
import { DockGeometry } from '../../../services/dock-layout/dock-geometry';
import { DockNode, mkSplit, mkStack, StackNode } from '../../../services/dock-layout/dock-node';
import { DockPanelRegistry } from '../../../services/dock-layout/dock-panel-registry';
import { DockState } from '../../../services/dock-layout/dock-state';
import { findStackOfPanel, firstStackOfRole } from '../../../services/dock-layout/dock-tree';
import { DockContainer } from '../dock-container/dock-container';
import { DockPanelPlaceholder } from '../dock-panel-placeholder/dock-panel-placeholder';

/**
 * How many times the main content has been created and destroyed.
 */
const lives: { created: number; destroyed: number } = { created: 0, destroyed: 0 };

/**
 * Stands in for the content a view is built around.
 */
@Component({ selector: 'app-test-editor', template: 'editor' })
class TestEditor {
  public readonly panel: InputSignal<unknown> = input<unknown>();

  public constructor() {
    lives.created += 1;
    inject(DestroyRef).onDestroy((): void => {
      lives.destroyed += 1;
    });
  }
}

/**
 * A dock with a main group between two tool groups.
 */
const BLUEPRINT: DockBlueprint = {
  key: 'test-main',
  createLayout: (): DockNode =>
    mkSplit('row', [
      mkStack('tool', ['files']),
      mkStack('main', ['editor']),
      mkStack('tool', ['agent']),
    ]),
  panels: [
    { id: 'editor', title: 'Editor', icon: Icon.CODE, role: 'main', component: TestEditor },
    ...['files', 'agent'].map(
      (id: string) =>
        ({
          id,
          title: id,
          icon: Icon.CODE,
          role: 'tool',
          component: DockPanelPlaceholder,
        }) as const,
    ),
  ],
};

describe('a dock with a main group (#1565)', () => {
  let fixture: ComponentFixture<DockContainer>;
  let host: HTMLElement;
  let dock: DockState;

  /**
   * Gets the main group.
   * @returns Returns the group.
   */
  function main(): StackNode {
    return firstStackOfRole(dock.layout(), 'main')!;
  }

  beforeEach(async () => {
    localStorage.clear();
    lives.created = 0;
    lives.destroyed = 0;
    await TestBed.configureTestingModule({
      imports: [DockContainer],
      providers: [{ provide: DOCK_BLUEPRINT, useValue: BLUEPRINT }],
    }).compileComponents();
    fixture = TestBed.createComponent(DockContainer);
    host = fixture.nativeElement as HTMLElement;
    dock = TestBed.inject(DockState);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('render_showsItsContentOnce_withNoTabsTitleOrButtons', () => {
    expect(host.querySelectorAll('app-test-editor').length).toBe(1);
    expect(host.querySelectorAll('app-dock-main').length).toBe(1);
    expect(host.querySelectorAll('app-dock-tab-group').length).toBe(2);
    expect(host.querySelector('app-dock-main')?.childElementCount).toBe(0);
    expect(host.querySelector('.dock-container__main button')).toBeNull();
  });

  it('rearranging_neverCreatesItsContentAfresh', async () => {
    const element: Element | null = host.querySelector('app-test-editor');

    dock.splitStack(main().id, 'output', 'bottom', 'tool');
    fixture.detectChanges();
    await dock.requestClose('files');
    await dock.requestClose('agent');
    await dock.requestClose('output');
    fixture.detectChanges();
    expect(dock.layout()).toBe(main());
    dock.dockEdge('agent', 'left');
    fixture.detectChanges();
    dock.undo();
    fixture.detectChanges();
    dock.redo();
    fixture.detectChanges();
    dock.reset();
    fixture.detectChanges();

    expect(host.querySelector('app-test-editor')).toBe(element);
    expect(lives).toEqual({ created: 1, destroyed: 0 });
  });

  it('its_panelCannotBeClosedFloatedOrHidden', async () => {
    const before: DockNode = dock.layout();

    expect(await dock.requestClose('editor')).toBe(false);
    dock.release('editor');
    dock.removeStack(main().id);
    TestBed.inject(DockFloating).float('editor', { left: 0, top: 0, width: 10, height: 10 });
    TestBed.inject(DockAutoHide).pin(main().id, 'left');

    expect(dock.layout()).toBe(before);
    expect(dock.isReleased('editor')).toBe(false);
    expect(TestBed.inject(DockFloating).floats()).toEqual([]);
  });

  it('it_cannotBeDragged', () => {
    const drag: DockDrag = TestBed.inject(DockDrag);

    drag.begin('editor', new MouseEvent('mousedown'));
    drag.beginGroup(main().id, new MouseEvent('mousedown'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }));

    expect(drag.active()).toBe(false);
    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('a_groupBesideIt_keepsThePixelsItsPanelPrefers_andADividerSetsThem', () => {
    const registry: DockPanelRegistry = TestBed.inject(DockPanelRegistry);
    registry.register({ ...registry.get('agent')!, defaultInlineSize: 360, maxInlineSize: 400 });
    fixture.detectChanges();
    const panes: HTMLElement[] = [...host.querySelectorAll<HTMLElement>('.dock-node__pane')];
    expect(panes.map((pane: HTMLElement): string => pane.style.flexBasis)).toEqual([
      '0px',
      '0px',
      '360px',
    ]);
    panes[1].getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 900, 500);
    panes[2].getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 360, 500);

    /**
     * Drags the divider beside the group.
     * @param by How far, in pixels.
     */
    function dragBy(by: number): void {
      [...host.querySelectorAll('app-split-divider')]
        .at(-1)!
        .dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0 }),
        );
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: by }));
      document.dispatchEvent(new MouseEvent('mouseup'));
      fixture.detectChanges();
    }

    dragBy(-20);
    expect(panes[2].style.flexBasis).toBe('380px');
    expect(findStackOfPanel(dock.layout(), 'agent')?.size).toBe(380);

    dragBy(-200);
    expect(panes[2].style.flexBasis).toBe('400px');

    dock.undo();
    fixture.detectChanges();
    expect(panes[2].style.flexBasis).toBe('380px');

    dock.reset();
    fixture.detectChanges();
    expect(
      [...host.querySelectorAll<HTMLElement>('.dock-node__pane')].at(-1)?.style.flexBasis,
    ).toBe('360px');
  });

  it('a_panelDroppedOnIt_staysWhereItWas', () => {
    const drag: DockDrag = TestBed.inject(DockDrag);
    const before: DockNode = dock.layout();
    host.querySelector<HTMLElement>('app-dock-main')!.getBoundingClientRect = (): DOMRect =>
      new DOMRect(0, 0, 900, 900);

    drag.begin('agent', new MouseEvent('mousedown', { clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450, clientY: 450 }));
    expect(drag.active()).toBe(true);
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 450, clientY: 450 }));

    expect(drag.active()).toBe(false);
    expect(dock.layout()).toBe(before);
    expect(TestBed.inject(DockFloating).floats()).toEqual([]);
  });

  it('a_panelDroppedOnItsSide_docksThere', () => {
    const drag: DockDrag = TestBed.inject(DockDrag);
    host.querySelector<HTMLElement>('app-dock-main')!.getBoundingClientRect = (): DOMRect =>
      new DOMRect(0, 0, 900, 900);

    drag.begin('agent', new MouseEvent('mousedown', { clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450, clientY: 850 }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 450, clientY: 850 }));

    const split: DockNode = dock.layout();
    expect(split.kind === 'split' && split.children[1].kind).toBe('split');
  });

  it('a_dragCanFindItsSlot_howeverOftenTheLayoutChanges', async () => {
    const geometry: DockGeometry = TestBed.inject(DockGeometry);
    await dock.requestClose('files');
    await dock.requestClose('agent');
    fixture.detectChanges();
    dock.dockEdge('agent', 'left');
    fixture.detectChanges();
    const slot: HTMLElement = host.querySelector<HTMLElement>('app-dock-main')!;
    slot.getBoundingClientRect = (): DOMRect => new DOMRect(10, 20, 300, 400);

    expect(geometry.rectOf(main().id)?.width).toBe(300);
    expect(geometry.groupAt(100, 100)?.role).toBe('main');
  });

  it('it_startsFocused_andPressingItsContentFocusesItAgain', () => {
    const focus: DockFocus = TestBed.inject(DockFocus);
    expect(focus.focusedStackId()).toBe(main().id);

    focus.focus(findStackOfPanel(dock.layout(), 'agent')!.id);
    host
      .querySelector('app-test-editor')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(focus.focusedStackId()).toBe(main().id);
  });

  it('a_savedLayoutWithoutIt_startsAfresh', () => {
    localStorage.setItem(
      'dock.layout.test-main',
      JSON.stringify(mkSplit('row', [mkStack('document', [], true), mkStack('tool', ['agent'])])),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: DOCK_BLUEPRINT, useValue: BLUEPRINT }],
    });

    const restored: DockState = TestBed.inject(DockState);

    expect(firstStackOfRole(restored.layout(), 'main')?.panels).toEqual(['editor']);
    expect(TestBed.inject(DockPanelRegistry).has('editor')).toBe(true);
  });
});
