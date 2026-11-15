import { TerminalPanel } from '@shared/angular/components/panels/terminal-panel/terminal-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { ConnectionsPanel } from './panels/connections-panel/connections-panel';
import { InterfacesPanel } from './panels/interfaces-panel/interfaces-panel';

/**
 * The blueprint specialising a dock instance as a Network Explorer: the Interfaces full-height on the
 * left, and beside them the well over the Connections, with the terminal tabbed behind them.
 *
 * The well holds `document`-role panels exactly as a workspace's does, so what is watched — a capture
 * on an interface, or on one connection — arrives as a document with tabbing, splitting, floating and
 * popping out for free. Until capture lands it starts empty, which is why the Connections are given
 * an even share of the height rather than a strip beneath it: today they are the view's substance.
 * The terminal sits behind them because `ping`, `dig` and `curl` beside a connection list is natural.
 */
export const NETWORK_EXPLORER_DOCK_BLUEPRINT: DockBlueprint = {
  key: 'network-explorer',
  createLayout(): DockNode {
    return mkSplit(
      'row',
      [
        mkStack('tool', ['interfaces']),
        mkSplit(
          'col',
          [mkStack('document', [], true), mkStack('tool', ['connections', 'terminal'])],
          [2.5, 2.5],
        ),
      ],
      [1.5, 5],
    );
  },
  panels: [
    {
      id: 'interfaces',
      title: 'Interfaces',
      icon: Icon.NETWORK_INTERFACES,
      role: 'tool',
      component: InterfacesPanel,
    },
    {
      id: 'connections',
      title: 'Connections',
      icon: Icon.NETWORK_CONNECTIONS,
      role: 'tool',
      component: ConnectionsPanel,
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
