import { Icon } from '@shared/angular/icons/icon';
import { DockPanelPlaceholder } from '../../components/dock/dock-panel-placeholder/dock-panel-placeholder';
import { DockBlueprint } from './dock-blueprint';
import { DockNode } from './dock-node';
import { DockPanel } from './dock-panel';
import { defaultLayout } from './dock-tree';

/**
 * A blueprint standing in for a real tab's, for dock unit tests. It reuses the workspace default
 * layout and catalogues the panels that layout references, each bound to the neutral
 * {@link DockPanelPlaceholder} so tests exercise dock mechanics without pulling in feature panels.
 * The dock itself no longer carries a built-in default — every real tab provides its own blueprint —
 * so specs that need a populated dock provide this one.
 */
const TEST_PANEL_TITLES: Readonly<Record<string, string>> = {
  files: 'File Explorer',
  solution: 'Solution Explorer',
  agent: 'Agent',
  output: 'Output',
  errors: 'Error List',
  terminal: 'Terminal',
};

export const TEST_DOCK_BLUEPRINT: DockBlueprint = {
  createLayout: (): DockNode => defaultLayout(),
  panels: Object.entries(TEST_PANEL_TITLES).map(
    ([id, title]: [string, string]): DockPanel => ({
      id,
      title,
      icon: Icon.CODE,
      role: 'tool',
      component: DockPanelPlaceholder,
    }),
  ),
};
