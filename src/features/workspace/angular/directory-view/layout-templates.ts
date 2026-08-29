import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { LayoutTemplate } from '@shared/angular/services/layouts/layouts';

/**
 * Holds the identifier of the Default template, which is also the layout the dock falls back to when
 * a workspace has no layouts at all.
 */
export const DEFAULT_TEMPLATE_ID: string = 'default';

/**
 * Holds the identifier of the Source Control template, which the Commit command stages transiently.
 */
export const SOURCE_CONTROL_TEMPLATE_ID: string = 'source-control';

/**
 * Holds the identifier of the Agentic Engineering template.
 */
export const AGENTIC_TEMPLATE_ID: string = 'agentic-engineering';

/**
 * The layouts a user can start from. A template is a starting point and nothing more: choosing one in
 * the layout manager copies its tree into a new layout of the user's own, which they then rename,
 * rearrange, save over and delete like any other. Nothing here is immutable, and nothing here appears
 * in the ribbon's layout list — only the user's layouts do.
 *
 * Each names every panel it wants at BEST — the Solution Explorer, Packages, the source-control trio.
 * A workspace without a project system, a package ecosystem, or a repository simply shows fewer of
 * them (see {@link import('@shared/angular/services/dock-layout/dock-panel-availability').DockPanelAvailability}),
 * and the panel appears in the place named here the moment its backing arrives. That is why a template
 * may state its whole ambition without checking what the folder turns out to be.
 */
export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = [
  {
    id: DEFAULT_TEMPLATE_ID,
    name: 'Default',
    // The everyday IDE: the two explorers tabbed on the left, the agent full-height on the right, and
    // the document well over a bottom strip of the things a build produces.
    createLayout: (): DockNode =>
      mkSplit(
        'row',
        [
          mkStack('tool', ['files', 'solution']),
          mkSplit(
            'col',
            [
              mkStack('document', [], true),
              mkStack('tool', ['packages', 'terminal', 'errors', 'output']),
            ],
            [4, 1.5],
          ),
          mkStack('tool', ['agent']),
        ],
        [1.4, 4, 1.6],
      ),
  },
  {
    id: SOURCE_CONTROL_TEMPLATE_ID,
    name: 'Source Control',
    // Repository and Commit share the left column as tabs — the two halves of deciding what to commit,
    // one at a time. History and Terminal share the centre the same way, the graph in front: both want
    // the whole of it, and what the terminal is for here is the command the history just made you want
    // to run. There is deliberately no document well; a diff opens one beside the centre when earned.
    createLayout: (): DockNode =>
      mkSplit(
        'row',
        [
          mkStack('tool', ['branches', 'commit']),
          mkStack('tool', ['history', 'terminal'], true),
          mkStack('tool', ['agent']),
        ],
        [1.2, 3.4, 1.6],
      ),
  },
  {
    id: AGENTIC_TEMPLATE_ID,
    name: 'Agentic Engineering',
    // The agent holds the centre, where the document well usually is, and the bottom strip starts
    // collapsed — the work is the conversation, and everything else is a tab away without spending
    // any room on it. Opening a file splits a well off beside the agent rather than displacing it.
    createLayout: (): DockNode =>
      mkSplit(
        'row',
        [
          mkStack('tool', ['files', 'solution']),
          mkSplit(
            'col',
            [
              mkStack('tool', ['agent'], true),
              mkStack('tool', ['packages', 'terminal', 'errors', 'output'], false, {
                collapsed: true,
                side: 'bottom',
              }),
            ],
            [4, 1.5],
          ),
        ],
        [1.4, 5.6],
      ),
  },
];
