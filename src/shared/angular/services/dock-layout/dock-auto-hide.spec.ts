import { TestBed } from '@angular/core/testing';
import { DockAutoHide } from './dock-auto-hide';
import { isStackNode, StackNode } from './dock-node';
import { DockState } from './dock-state';
import { findNode, findStackOfPanel, firstStackOfRole } from './dock-tree';

describe('DockAutoHide', () => {
  let autoHide: DockAutoHide;
  let state: DockState;

  /**
   * Resolves the identifier of the stack holding a panel.
   * @param panelId The panel whose stack to resolve.
   * @returns Returns the stack identifier.
   */
  function stackId(panelId: string): string {
    const stack: StackNode | null = findStackOfPanel(state.layout(), panelId);
    expect(stack).not.toBeNull();
    return stack!.id;
  }

  /**
   * Reads whether the stack holding a panel is collapsed.
   * @param panelId The panel whose stack to read.
   * @returns Returns true when the stack is collapsed.
   */
  function isCollapsed(panelId: string): boolean {
    const stack: StackNode | null = findStackOfPanel(state.layout(), panelId);
    return stack?.collapsed === true;
  }

  /**
   * Opens a document into the well and returns its id.
   * @returns Returns the seeded document panel id.
   */
  function seedDocument(): string {
    const well: StackNode | null = firstStackOfRole(state.layout(), 'document');
    expect(well).not.toBeNull();
    state.tabInto(well!.id, 'doc-a');
    return 'doc-a';
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    autoHide = TestBed.inject(DockAutoHide);
    state = TestBed.inject(DockState);
  });

  it('pin_whenToolStack_collapsesItInPlace', () => {
    const id: string = stackId('files');

    autoHide.pin(id);

    expect(isCollapsed('files')).toBe(true);
    // The stack keeps its slot in the tree rather than being removed.
    expect(findNode(state.layout(), id)).not.toBeNull();
  });

  it('pin_whenGivenTheEdgeItHugs_recordsItOnTheStack', () => {
    const id: string = stackId('agent');

    autoHide.pin(id, 'right');

    const stack: StackNode | null = findStackOfPanel(state.layout(), 'agent');
    expect(stack?.side).toBe('right');
  });

  it('unpin_whenCalled_forgetsTheRecordedEdge', () => {
    const id: string = stackId('agent');
    autoHide.pin(id, 'right');

    autoHide.unpin(id);

    const stack: StackNode | null = findStackOfPanel(state.layout(), 'agent');
    expect(stack?.side).toBeUndefined();
  });

  it('pin_whenDocumentWell_isIgnored', () => {
    const doc: string = seedDocument();

    autoHide.pin(stackId(doc));

    expect(isCollapsed(doc)).toBe(false);
  });

  it('unpin_whenCalled_expandsTheStackAndEndsThePeek', () => {
    const id: string = stackId('output');
    autoHide.pin(id);
    autoHide.showFlyout(id, 'output');

    autoHide.unpin(id);

    expect(isCollapsed('output')).toBe(false);
    expect(autoHide.flyoutStackId()).toBeNull();
    expect(findStackOfPanel(state.layout(), 'output')).not.toBeNull();
    expect(findStackOfPanel(state.layout(), 'errors')).not.toBeNull();
  });

  it('showFlyout_whenCalled_setsThePeekAndActivePanel', () => {
    const id: string = stackId('output');
    autoHide.pin(id);

    autoHide.showFlyout(id, 'errors');

    expect(autoHide.flyoutStackId()).toBe(id);
    const stack: StackNode | null = findStackOfPanel(state.layout(), 'errors');
    expect(stack !== null && isStackNode(stack) ? stack.active : null).toBe('errors');
  });

  it('showFlyout_whenActivePanelClickedAgain_togglesThePeekClosed', () => {
    const id: string = stackId('output');
    autoHide.pin(id);
    autoHide.showFlyout(id, 'errors');

    autoHide.showFlyout(id, 'errors');

    expect(autoHide.flyoutStackId()).toBeNull();
  });

  it('closePanel_whenLastPanelClosed_removesTheStackAndEndsThePeek', () => {
    const id: string = stackId('files');
    autoHide.pin(id);
    autoHide.showFlyout(id, 'files');

    autoHide.closePanel(id, 'files');

    expect(findStackOfPanel(state.layout(), 'files')).toBeNull();
    expect(autoHide.flyoutStackId()).toBeNull();
  });
});
