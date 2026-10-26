import { TerminalPanel } from '@shared/angular/components/panels/terminal-panel/terminal-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { DatabaseAgentPanel } from './panels/database-agent-panel/database-agent-panel';
import { ObjectExplorerPanel } from './panels/object-explorer-panel/object-explorer-panel';
import { PropertiesPanel } from './panels/properties-panel/properties-panel';

/**
 * The blueprint specialising a dock instance as a Database Explorer — SSMS's arrangement: the Object
 * Explorer full-height on the left, the query well in the middle with the terminal collapsed under it,
 * and Properties and the agent tabbed together on the right. Each query carries its own Results and Messages beneath its editor, as an
 * SSMS query window does, so the well needs no shared results panel.
 *
 * The well holds `document`-role panels exactly as a workspace's does, so tabbing, splitting, floating,
 * popping out and layout persistence arrive for free. The terminal starts collapsed under the well:
 * reaching for `psql` or `cypher-shell` beside a query is natural, and a strip costs nothing until it
 * is opened.
 */
export const DATABASE_EXPLORER_DOCK_BLUEPRINT: DockBlueprint = {
  key: 'database-explorer',
  createLayout(): DockNode {
    return mkSplit(
      'row',
      [
        mkStack('tool', ['objects']),
        // The well, and under it the terminal, collapsed to a strip until it is wanted.
        mkSplit(
          'col',
          [
            mkStack('document', [], true),
            mkStack('tool', ['terminal'], false, { collapsed: true, side: 'bottom' }),
          ],
          [4, 1.5],
        ),
        mkStack('tool', ['properties', 'agent']),
      ],
      [1.5, 4.2, 1.6],
    );
  },
  panels: [
    {
      id: 'objects',
      title: 'Object Explorer',
      icon: Icon.DATABASE_OBJECTS,
      role: 'tool',
      component: ObjectExplorerPanel,
    },
    {
      id: 'properties',
      title: 'Properties',
      icon: Icon.DATABASE_PROPERTIES,
      role: 'tool',
      component: PropertiesPanel,
    },
    {
      id: 'agent',
      title: 'Agent',
      icon: Icon.AGENT,
      role: 'tool',
      component: DatabaseAgentPanel,
    },
    {
      id: 'terminal',
      title: 'Terminal',
      icon: Icon.TERMINAL,
      role: 'tool',
      component: TerminalPanel,
    },
  ],
};
