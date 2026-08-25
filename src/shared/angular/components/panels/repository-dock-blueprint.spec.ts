import { DockNode, StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { collectPanelIds, firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';

import { REPOSITORY_DOCK_BLUEPRINT } from './repository-dock-blueprint';

/**
 * Finds the stack holding a panel.
 * @param tree The layout.
 * @param panelId The panel to find.
 * @returns Returns the stack, or null when the panel is not in the layout.
 */
function stackOf(tree: DockNode, panelId: string): StackNode | null {
  if (tree.kind === 'stack') {
    return tree.panels.includes(panelId) ? tree : null;
  }
  for (const child of tree.children) {
    const found: StackNode | null = stackOf(child, panelId);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

describe('REPOSITORY_DOCK_BLUEPRINT', () => {
  let layout: DockNode;

  beforeEach(() => {
    layout = REPOSITORY_DOCK_BLUEPRINT.createLayout();
  });

  it('opensWithEveryPanelItDeclares', () => {
    const placed: readonly string[] = collectPanelIds(layout);

    expect([...placed].sort()).toEqual(
      REPOSITORY_DOCK_BLUEPRINT.panels.map((panel): string => panel.id).sort(),
    );
  });

  it('tabsRepositoryAndCommitTogether_asOneLeftColumn', () => {
    const left: StackNode | null = stackOf(layout, 'branches');

    expect(left?.panels).toEqual(['branches', 'commit']);
    // Repository leads: which branch you are on comes before what you are committing to it.
    expect(left?.active).toBe('branches');
  });

  it('givesHistoryTheCentre', () => {
    const centre: StackNode | null = stackOf(layout, 'history');

    expect(centre?.panels).toEqual(['history']);
    expect(centre?.primary).toBe(true);
  });

  it('opensTheTerminalCollapsed_alongTheBottomOfTheCentre', () => {
    const terminal: StackNode | null = stackOf(layout, 'terminal');

    // Present but shut: wanted often enough to keep its strip, seldom enough not to take a third of
    // the column to say so.
    expect(terminal?.panels).toEqual(['terminal']);
    expect(terminal?.collapsed).toBe(true);
    expect(terminal?.side).toBe('bottom');
  });

  it('givesTheAgentItsOwnColumn', () => {
    const agent: StackNode | null = stackOf(layout, 'agent');

    expect(agent?.panels).toEqual(['agent']);
  });

  it('opensWithNoDocumentWell_soHistoryIsNotSharingWithAGap', () => {
    // History is what this surface is for. A well standing empty above it would be space kept for a
    // diff that may never be asked for; DiffOpener makes one the first time it is.
    expect(firstStackOfRole(layout, 'document')).toBeNull();
  });
});
