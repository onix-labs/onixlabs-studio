import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MockInstance, vi } from 'vitest';
import { DOCK_BLUEPRINT } from '../../../services/dock-layout/dock-blueprint';
import { TEST_DOCK_BLUEPRINT } from '../../../services/dock-layout/dock-test-blueprint';
import { DockDrag } from '../../../services/dock-layout/dock-drag';
import { DockFloating } from '../../../services/dock-layout/dock-floating';
import { mkStack, StackNode } from '../../../services/dock-layout/dock-node';
import { DockPanelAvailability } from '../../../services/dock-layout/dock-panel-availability';
import { DockPanelRegistry } from '../../../services/dock-layout/dock-panel-registry';
import { DockState } from '../../../services/dock-layout/dock-state';
import { DockGeometry } from '../../../services/dock-layout/dock-geometry';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanelPlaceholder } from '../dock-panel-placeholder/dock-panel-placeholder';
import { findStackOfPanel } from '../../../services/dock-layout/dock-tree';
import { DockTabGroup } from './dock-tab-group';

describe('DockTabGroup', () => {
  let component: DockTabGroup;
  let fixture: ComponentFixture<DockTabGroup>;
  let floating: DockFloating;
  let drag: DockDrag;
  let availability: DockPanelAvailability;

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
    availability = TestBed.inject(DockPanelAvailability);
  });

  describe('tab fill during a splitter drag', () => {
    /**
     * Reaches the component's resize handling, which jsdom (no layout, no observer) cannot drive.
     * @returns Returns the handle.
     */
    function internals(): {
      naturalTabsExtent: number | null;
      onStripResized: (entries: readonly ResizeObserverEntry[]) => void;
    } {
      return component as unknown as {
        naturalTabsExtent: number | null;
        onStripResized: (entries: readonly ResizeObserverEntry[]) => void;
      };
    }

    /**
     * Builds the entry a resize observer reports for a strip of a width.
     * @param width The strip's width.
     * @returns Returns the entries.
     */
    function resized(width: number): readonly ResizeObserverEntry[] {
      return [
        {
          borderBoxSize: [{ inlineSize: width, blockSize: 24 }],
          contentRect: { width } as DOMRectReadOnly,
        } as unknown as ResizeObserverEntry,
      ];
    }

    /**
     * Gets whether the group shows its tabs filling the strip.
     * @returns Returns true when filling.
     */
    function filling(): boolean {
      fixture.detectChanges();
      return (fixture.nativeElement as HTMLElement).classList.contains('dock-tab-group--tabs-fill');
    }

    it('snapsMidDrag_fromTheReportedWidth_againstTheTabsRememberedReach', () => {
      // The perf deferral (#560) stopped measuring mid-drag, so the tab never snapped until release.
      render(mkStack('tool', ['output', 'errors']));
      const geometry: DockGeometry = TestBed.inject(DockGeometry);
      internals().naturalTabsExtent = 200;
      geometry.beginInteractiveResize();

      internals().onStripResized(resized(240));
      expect(filling()).toBe(false);
      internals().onStripResized(resized(214)); // within 16px of the tabs' end
      expect(filling()).toBe(true);
      internals().onStripResized(resized(260)); // and back out again
      expect(filling()).toBe(false);

      geometry.endInteractiveResize();
    });

    it('beforeAnyMeasurement_waitsForRelease_ratherThanGuessing', () => {
      render(mkStack('tool', ['output', 'errors']));
      const geometry: DockGeometry = TestBed.inject(DockGeometry);
      internals().naturalTabsExtent = null;
      const before: boolean = filling();
      geometry.beginInteractiveResize();

      internals().onStripResized(resized(10));
      internals().onStripResized(resized(5000));

      // Nothing remembered to compare against: the fill is left alone until the release measures it.
      expect(filling()).toBe(before);
      geometry.endInteractiveResize();
    });
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

  it('render_passesOverAPanelWhoseBackingIsAbsent_withoutTouchingTheStack', () => {
    // A layout names what the user wants at best. What this workspace can actually show is a
    // rendering question, so the tab goes and the stack keeps naming it.
    const stack: StackNode = mkStack('tool', ['output', 'errors']);
    availability.set({ output: false });
    render(stack);

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const labels: readonly string[] = [...element.querySelectorAll('.dock-tab__label')].map(
      (label: Element): string => label.textContent?.trim() ?? '',
    );
    expect(labels).toEqual(['Error List']);
    expect(stack.panels).toEqual(['output', 'errors']);
  });

  it('render_whenTheActivePanelsBackingIsAbsent_fallsToTheFirstItCanShow', () => {
    availability.set({ output: false });
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.dock-tab-group__title-text')?.textContent).toContain(
      'Error List',
    );
    expect(element.querySelector('.dock-tab--active')?.textContent).toContain('Error List');
  });

  it('render_whenNoPanelCanBeShown_rendersNothing', () => {
    availability.set({ output: false, errors: false });
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
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

  it('render_drawsNoToolStripOfItsOwn_forADocumentOrAToolPanel (#882)', () => {
    // The dock once drew a strip of placeholder buttons for any panel without one of its own. A panel
    // with tools now draws its own strip in its body; one without shows none, rather than inert
    // buttons.
    const registry: DockPanelRegistry = TestBed.inject(DockPanelRegistry);
    registry.register({
      id: 'plain-doc',
      title: 'File',
      icon: Icon.CODE,
      role: 'document',
      component: DockPanelPlaceholder,
    });
    registry.register({
      id: 'plain-tool',
      title: 'Tool',
      icon: Icon.CODE,
      role: 'tool',
      component: DockPanelPlaceholder,
    });

    for (const stack of [mkStack('document', ['plain-doc']), mkStack('tool', ['plain-tool'])]) {
      render(stack);
      const element: HTMLElement = fixture.nativeElement as HTMLElement;
      expect(element.querySelector('[class*="tool-strip"]')).toBeNull();
    }
  });

  it('closeAll_whenCloseAllClicked_closesEveryDocumentInTheWellInTabOrder', () => {
    const registry: DockPanelRegistry = TestBed.inject(DockPanelRegistry);
    for (const id of ['doc-a', 'doc-b']) {
      registry.register({
        id,
        title: id,
        icon: Icon.CODE,
        role: 'document',
        component: DockPanelPlaceholder,
      });
    }
    const closeAll: MockInstance = vi
      .spyOn(TestBed.inject(DockState), 'requestCloseAll')
      .mockResolvedValue();
    render(mkStack('document', ['doc-a', 'doc-b']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('button[aria-label="Close All"]')?.click();

    expect(closeAll).toHaveBeenCalledWith(['doc-a', 'doc-b']);
  });

  it('close_whenADocumentListRowsCloseClicked_closesThatDocument', () => {
    const registry: DockPanelRegistry = TestBed.inject(DockPanelRegistry);
    for (const id of ['doc-a', 'doc-b']) {
      registry.register({
        id,
        title: id,
        icon: Icon.CODE,
        role: 'document',
        component: DockPanelPlaceholder,
      });
    }
    const close: MockInstance = vi
      .spyOn(TestBed.inject(DockState), 'requestClose')
      .mockResolvedValue(true);
    render(mkStack('document', ['doc-a', 'doc-b']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('button[aria-label="Documents"]')?.click();
    fixture.detectChanges();
    document.querySelector<HTMLButtonElement>('button[aria-label="Close doc-b"]')?.click();

    expect(close).toHaveBeenCalledWith('doc-b');
  });

  describe('a document tab’s context menu', () => {
    let state: DockState;

    beforeEach(() => {
      const registry: DockPanelRegistry = TestBed.inject(DockPanelRegistry);
      for (const id of ['doc-a', 'doc-b', 'doc-c']) {
        registry.register({
          id,
          title: id,
          icon: Icon.CODE,
          role: 'document',
          component: DockPanelPlaceholder,
        });
      }
      state = TestBed.inject(DockState);
    });

    afterEach(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    /**
     * Right-clicks a tab and returns the menu's rows.
     * @param label The tab's label.
     * @returns Returns the rows' buttons.
     */
    function openMenuOn(label: string): HTMLElement[] {
      const tab: HTMLElement | undefined = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.dock-tab'),
      ).find((element: HTMLElement): boolean => element.textContent.includes(label));
      tab?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
      fixture.detectChanges();
      return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    }

    /**
     * Chooses a row of the open menu by its label.
     * @param rows The menu's rows.
     * @param label The row's label.
     */
    function choose(rows: HTMLElement[], label: string): void {
      rows.find((row: HTMLElement): boolean => row.textContent.trim() === label)?.click();
    }

    it('offersTheCloseAndSplitCommands_inOrder', () => {
      render(mkStack('document', ['doc-a', 'doc-b']));

      const labels: string[] = openMenuOn('doc-a').map((row: HTMLElement): string =>
        row.textContent.trim(),
      );

      expect(labels).toEqual([
        'Close',
        'Close All',
        'Close All But This',
        'Split to Top',
        'Split to Bottom',
        'Split to Left',
        'Split to Right',
      ]);
    });

    it('closeAllButThis_closesTheOtherTabs_inTabOrder', () => {
      const closeAll: MockInstance = vi.spyOn(state, 'requestCloseAll').mockResolvedValue();
      render(mkStack('document', ['doc-a', 'doc-b', 'doc-c']));

      choose(openMenuOn('doc-b'), 'Close All But This');

      expect(closeAll).toHaveBeenCalledWith(['doc-a', 'doc-c']);
    });

    it('close_closesTheTabItWasOpenedOn_notTheActiveOne', () => {
      const close: MockInstance = vi.spyOn(state, 'requestClose').mockResolvedValue(true);
      render(mkStack('document', ['doc-a', 'doc-b']));

      choose(openMenuOn('doc-b'), 'Close');

      expect(close).toHaveBeenCalledWith('doc-b');
    });

    it('splitToRight_splitsThatTabOutToTheRight', () => {
      const split: MockInstance = vi.spyOn(state, 'splitPanelOut').mockReturnValue(undefined);
      render(mkStack('document', ['doc-a', 'doc-b']));

      choose(openMenuOn('doc-b'), 'Split to Right');

      expect(split).toHaveBeenCalledWith('doc-b', 'right');
    });

    it('aWellsOnlyTab_cannotBeSplitOut_orHaveOthersClosed', () => {
      render(mkStack('document', ['doc-a']));

      const disabled: string[] = openMenuOn('doc-a')
        .filter((row: HTMLElement): boolean => row.getAttribute('aria-disabled') === 'true')
        .map((row: HTMLElement): string => row.textContent.trim());

      expect(disabled).toEqual([
        'Close All But This',
        'Split to Top',
        'Split to Bottom',
        'Split to Left',
        'Split to Right',
      ]);
    });
  });

  it('render_whenToolRole_omitsTheCloseAllButton', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('button[aria-label="Close All"]')).toBeNull();
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
