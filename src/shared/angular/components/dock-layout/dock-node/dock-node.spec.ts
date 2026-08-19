import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockAutoHide } from '../../../services/dock-layout/dock-auto-hide';
import {
  DockNode as DockTreeNode,
  DockSide,
  mkSplit,
  mkStack,
  StackNode,
} from '../../../services/dock-layout/dock-node';
import { DockNode } from './dock-node';

describe('DockNode', () => {
  let component: DockNode;
  let fixture: ComponentFixture<DockNode>;

  /**
   * Renders the given tree node.
   * @param node The node to render.
   */
  function render(node: DockTreeNode): void {
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
  }

  /**
   * Builds a collapsed tool stack, optionally remembering the edge it was collapsed against.
   * @param panels The panels the stack holds.
   * @param side The remembered edge, or undefined for none.
   * @returns Returns the collapsed stack.
   */
  function collapsed(panels: readonly string[], side?: DockSide): StackNode {
    return { ...mkStack('tool', panels), collapsed: true, ...(side === undefined ? {} : { side }) };
  }

  /**
   * Reads the classes of a rendered element, matched in document order.
   * @param selector The selector to match.
   * @param index The index of the match to read.
   * @returns Returns the element's class list.
   */
  function classesOf(selector: string, index: number): DOMTokenList {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const match: HTMLElement | null = element.querySelectorAll<HTMLElement>(selector).item(index);
    expect(match).not.toBeNull();
    return match.classList;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockNode],
    }).compileComponents();

    fixture = TestBed.createComponent(DockNode);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    render(mkStack('document', ['doc1']));
    expect(component).toBeTruthy();
  });

  it('render_whenStack_rendersATabGroup', () => {
    render(mkStack('tool', ['output']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-dock-tab-group')).not.toBeNull();
  });

  it('render_whenSplitWithTwoChildren_interleavesOneSplitter', () => {
    render(mkSplit('row', [mkStack('tool', ['a']), mkStack('tool', ['b'])]));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.dock-node__pane').length).toBe(2);
    expect(element.querySelectorAll('app-dock-splitter').length).toBe(1);
  });

  it('render_whenNestedSplit_recursesIntoChildren', () => {
    render(
      mkSplit('row', [
        mkStack('tool', ['a']),
        mkSplit('col', [mkStack('document', ['doc1']), mkStack('tool', ['b'])]),
      ]),
    );

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    // One outer split plus one inner split renders three tab groups in total.
    expect(element.querySelectorAll('app-dock-tab-group').length).toBe(3);
    expect(element.querySelectorAll('.dock-node__split--col').length).toBe(1);
  });

  it('render_whenCollapsedStackHasNoRememberedEdge_orientsItByItsSlot', () => {
    render(mkSplit('row', [mkStack('document', ['doc']), collapsed(['agent'])]));

    expect(classesOf('app-dock-collapsed-strip', 0)).toContain('dock-collapsed-strip--right');
  });

  it('render_whenCollapsedStackRemembersAnEdgeOnThisAxis_keepsThatEdge', () => {
    // The gutter was collapsed against the right edge and has since been shuffled to the head of its
    // row. Its slot would say "left"; the edge it remembers wins, so the strip does not flip sides.
    render(mkSplit('row', [collapsed(['agent'], 'right'), mkStack('document', ['doc'])]));

    expect(classesOf('app-dock-collapsed-strip', 0)).toContain('dock-collapsed-strip--right');
  });

  it('render_whenTheRememberedEdgeRunsAcrossTheSplitAxis_fallsBackToTheSlot', () => {
    // A remembered `right` is meaningless in a column: it would draw a vertical strip in a pane that
    // is only as tall as a strip. The slot decides again.
    render(mkSplit('col', [mkStack('document', ['doc']), collapsed(['agent'], 'right')]));

    expect(classesOf('app-dock-collapsed-strip', 0)).toContain('dock-collapsed-strip--bottom');
  });

  it('render_whenEveryChildOfASplitIsCollapsed_anchorsTheTrailingStripsToTheEnd', () => {
    // Nothing grows in this column, so without the anchor both strips bunch at the top and the
    // bottom gutter's peek opens upward into the strip above it.
    render(mkSplit('col', [collapsed(['agent']), collapsed(['errors'])]));

    expect(classesOf('.dock-node__pane', 0)).not.toContain('dock-node__pane--end');
    expect(classesOf('.dock-node__pane', 1)).toContain('dock-node__pane--end');
  });

  it('render_whenASiblingCanGrow_leavesTheStripsToFlex', () => {
    render(mkSplit('col', [mkStack('document', ['doc']), collapsed(['errors'])]));

    expect(classesOf('.dock-node__pane', 1)).not.toContain('dock-node__pane--end');
  });

  it('render_whenAStripIsPeeking_liftsItsPaneAboveTheOtherStrips', () => {
    // Sibling strips are stacking contexts at the same depth, so the later one paints over an open
    // peek unless the peeking pane outranks it.
    const agent: StackNode = collapsed(['agent']);
    TestBed.inject(DockAutoHide).showFlyout(agent.id);

    render(mkSplit('col', [agent, collapsed(['errors'])]));

    expect(classesOf('.dock-node__pane', 0)).toContain('dock-node__pane--peeking');
    expect(classesOf('.dock-node__pane', 1)).not.toContain('dock-node__pane--peeking');
  });
});
