import { computed, effect, inject, Service, Signal } from '@angular/core';
import { Documents } from '@shared/angular/services/documents/documents';
import { Tab, TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AppMenu } from './app-menu';
import { MENU_SEPARATOR, MenuContribution, MenuEntry } from './app-menu-model';

/**
 * Orders the core's leading contribution ahead of every feature, so File opens with New and Open before
 * a feature's Save rather than after it.
 */
const CORE_LEADING_PRIORITY: number = 0;

/**
 * Orders the core's trailing contribution behind every feature, so Close Tab ends the File menu whatever
 * the active feature added to it.
 */
const CORE_TRAILING_PRIORITY: number = 1000;

/**
 * The tab types offered under File → New, in the order the welcome screen presents them.
 */
const NEW_TAB_TYPES: readonly { readonly type: TabType; readonly label: string }[] = [
  { type: 'code', label: 'Code File' },
  { type: 'markdown', label: 'Markdown Document' },
  { type: 'terminal', label: 'Terminal' },
  { type: 'agent', label: 'Agent' },
  { type: 'api-explorer', label: 'API Request' },
];

/**
 * The tools offered under View → Tools, each a singleton workbench surface.
 */
const TOOL_TAB_TYPES: readonly { readonly type: TabType; readonly label: string }[] = [
  { type: 'mission-control', label: 'Mission Control' },
  { type: 'containers', label: 'Containers' },
  { type: 'model-manager', label: 'AI Models' },
  { type: 'system-monitor', label: 'System Monitor' },
];

/**
 * Contributes the application menu's core sections — the ones that are true whichever tab is in front.
 *
 * Deliberately split into a leading and a trailing contribution around the features'. A feature folds
 * its own entries into File, and a menu that read New, Open, Close Tab, Save would be wrong; contributing
 * the openers first and the closers last puts a feature's Save exactly where it belongs, without the
 * feature having to know anything about the core.
 *
 * The Edit section is the platform's own editing commands, carried as native roles. It matters more than
 * it looks: on macOS the application menu is what binds the editing chords into the window at all, so
 * without these Cmd+X/C/V do nothing in any plain text box — which is exactly what happened when this
 * menu replaced Electron's default one. Roles are routed by focus rather than by tab, so the same entry
 * serves a composer's textarea, a code editor and a markdown pane without knowing which is in front.
 *
 * Select All is deliberately absent: the editors bind Cmd+A to their own selection model, and a core
 * entry claiming it would take the chord away from them. That one waits for focus-scoped keybindings.
 *
 * Instantiated once by the shell.
 */
@Service()
export class CoreMenu {
  /**
   * Holds the menu the core contributes to.
   */
  private readonly menu: AppMenu = inject(AppMenu);

  /**
   * Holds the tab registry, for opening and closing tabs.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the document registry, for the file commands.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Gets the active tab, or undefined when none is open.
   */
  private readonly activeTab: Signal<Tab | undefined> = computed((): Tab | undefined =>
    this.tabs.activeTab(),
  );

  /**
   * Gets the core's leading sections: everything that comes before a feature's own entries.
   */
  private readonly leading: Signal<readonly MenuContribution[]> = computed(
    (): readonly MenuContribution[] => [
      {
        id: 'file',
        label: 'File',
        items: [
          {
            id: 'core.file.new',
            label: 'New',
            items: NEW_TAB_TYPES.map(
              (entry: { type: TabType; label: string }): MenuEntry => ({
                id: `core.file.new.${entry.type}`,
                label: entry.label,
                run: (): void => void this.tabs.open(entry.type),
              }),
            ),
          },
          {
            id: 'core.file.open',
            label: 'Open File…',
            accelerator: 'CmdOrCtrl+O',
            run: (): void => void this.documents.openFile(),
          },
          MENU_SEPARATOR,
        ],
      },
      {
        id: 'edit',
        label: 'Edit',
        items: [
          { id: 'core.edit.undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
          { id: 'core.edit.redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
          MENU_SEPARATOR,
          { id: 'core.edit.cut', label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
          { id: 'core.edit.copy', label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
          { id: 'core.edit.paste', label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
          MENU_SEPARATOR,
        ],
      },
      {
        id: 'view',
        label: 'View',
        items: [
          {
            id: 'core.view.tools',
            label: 'Tools',
            items: TOOL_TAB_TYPES.map(
              (entry: { type: TabType; label: string }): MenuEntry => ({
                id: `core.view.tools.${entry.type}`,
                label: entry.label,
                run: (): void => void this.tabs.open(entry.type),
              }),
            ),
          },
          MENU_SEPARATOR,
        ],
      },
    ],
  );

  /**
   * Gets the core's trailing sections: everything that comes after a feature's own entries, plus the
   * sections no feature contributes to.
   */
  private readonly trailing: Signal<readonly MenuContribution[]> = computed(
    (): readonly MenuContribution[] => {
      const active: Tab | undefined = this.activeTab();
      return [
        {
          id: 'file',
          label: 'File',
          items: [
            MENU_SEPARATOR,
            {
              id: 'core.file.settings',
              label: 'Settings…',
              accelerator: 'CmdOrCtrl+,',
              run: (): void => void this.tabs.open('settings'),
            },
            MENU_SEPARATOR,
            {
              id: 'core.file.closeTab',
              label: 'Close Tab',
              accelerator: 'CmdOrCtrl+W',
              enabled: active !== undefined,
              run: (): void => {
                const tab: Tab | undefined = this.activeTab();
                if (tab !== undefined) {
                  this.tabs.close(tab.id);
                }
              },
            },
          ],
        },
        {
          id: 'view',
          label: 'View',
          items: [
            MENU_SEPARATOR,
            { id: 'core.view.fullscreen', label: 'Toggle Full Screen', role: 'togglefullscreen' },
            { id: 'core.view.devtools', label: 'Toggle Developer Tools', role: 'toggleDevTools' },
            { id: 'core.view.reload', label: 'Reload', role: 'forceReload' },
          ],
        },
        {
          id: 'window',
          label: 'Window',
          items: [
            { id: 'core.window.minimize', label: 'Minimise', role: 'minimize' },
            { id: 'core.window.zoom', label: 'Zoom', role: 'zoom' },
            MENU_SEPARATOR,
            { id: 'core.window.close', label: 'Close Window', role: 'close' },
          ],
        },
      ];
    },
  );

  /**
   * Initializes a new instance of the {@link CoreMenu} class, keeping both contributions current.
   */
  public constructor() {
    effect((): void => {
      this.menu.contribute('core.leading', this.leading(), CORE_LEADING_PRIORITY);
    });
    effect((): void => {
      this.menu.contribute('core.trailing', this.trailing(), CORE_TRAILING_PRIORITY);
    });
  }
}
