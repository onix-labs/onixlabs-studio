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

  it('tabsHistoryAndTerminalTogether_asTheCentre', () => {
    const centre: StackNode | null = stackOf(layout, 'history');

    // Both want the whole of the centre, and neither is wanted at the same moment as the other.
    expect(centre?.panels).toEqual(['history', 'terminal']);
    expect(centre?.primary).toBe(true);
    // History leads: the graph is what this surface is for, and the terminal is what it sends you to.
    expect(centre?.active).toBe('history');
  });

  it('opensTheTerminalUncollapsed_becauseItSharesTheCentreRatherThanEdgingIt', () => {
    const terminal: StackNode | null = stackOf(layout, 'terminal');

    // A tab in a stack has nothing to be collapsed against; the shut bottom strip it used to be is
    // what the tab replaced.
    expect(terminal?.collapsed).toBeUndefined();
    expect(terminal?.side).toBeUndefined();
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
