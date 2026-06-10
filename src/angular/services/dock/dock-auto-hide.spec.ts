import { TestBed } from '@angular/core/testing';
import { DockAutoHide, ShelvedStack } from './dock-auto-hide';
import { StackNode } from './dock-node';
import { DockState } from './dock-state';
import { findStackOfPanel } from './dock-tree';

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

  beforeEach(() => {
    TestBed.configureTestingModule({});
    autoHide = TestBed.inject(DockAutoHide);
    state = TestBed.inject(DockState);
  });

  it('pin_whenToolStack_shelvesItAndRemovesItFromTheLayout', () => {
    autoHide.pin(stackId('toolbox'));

    expect(
      autoHide.shelved().some((stack: ShelvedStack): boolean => stack.panels.includes('toolbox')),
    ).toBe(true);
    expect(findStackOfPanel(state.layout(), 'toolbox')).toBeNull();
  });

  it('pin_whenDocumentWell_isIgnored', () => {
    autoHide.pin(stackId('doc1'));

    expect(autoHide.shelved()).toHaveLength(0);
    expect(findStackOfPanel(state.layout(), 'doc1')).not.toBeNull();
  });

  it('unpin_whenCalled_redocksTheStackAndClearsTheShelf', () => {
    autoHide.pin(stackId('output'));
    const key: string = autoHide.shelved()[0].key;

    autoHide.unpin(key);

    expect(autoHide.shelved()).toHaveLength(0);
    expect(findStackOfPanel(state.layout(), 'output')).not.toBeNull();
    expect(findStackOfPanel(state.layout(), 'errors')).not.toBeNull();
  });

  it('occupiedEdges_whenStackShelved_marksItsEdge', () => {
    autoHide.pin(stackId('toolbox'));

    const edge: string = autoHide.shelved()[0].edge;
    expect(autoHide.occupiedEdges()[edge as 'left']).toBe(true);
  });

  it('showFlyout_whenCalled_setsTheFlyoutKeyAndActivePanel', () => {
    autoHide.pin(stackId('output'));
    const key: string = autoHide.shelved()[0].key;

    autoHide.showFlyout(key, 'errors');

    expect(autoHide.flyoutKey()).toBe(key);
    expect(autoHide.shelved()[0].active).toBe('errors');
  });

  it('closePanel_whenLastPanelClosed_removesTheShelfEntry', () => {
    autoHide.pin(stackId('toolbox'));
    const key: string = autoHide.shelved()[0].key;

    autoHide.closePanel(key, 'toolbox');

    expect(autoHide.shelved()).toHaveLength(0);
  });
});
