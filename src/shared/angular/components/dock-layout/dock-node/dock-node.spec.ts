import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockNode as DockTreeNode, mkSplit, mkStack } from '../../../services/dock-layout/dock-node';
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
});
