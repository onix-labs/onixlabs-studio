import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Tab } from '../../services/tabs/tab';
import { Tabs } from '../../services/tabs/tabs';
import { AgentView } from '../views/agent-view/agent-view';
import { CodeView } from '../views/code-view/code-view';
import { DirectoryView } from '../views/directory-view/directory-view';
import { MarkdownView } from '../views/markdown-view/markdown-view';
import { SettingsView } from '../views/settings-view/settings-view';
import { TerminalView } from '../views/terminal-view/terminal-view';

/**
 * Represents the content area that hosts the view for every open tab.
 *
 * Every open tab is mounted at once and inactive tabs are hidden rather than destroyed, so that
 * view state (editor undo history, scroll position, terminal sessions) survives tab switches.
 */
@Component({
  selector: 'app-content-host',
  imports: [SettingsView, DirectoryView, CodeView, MarkdownView, TerminalView, AgentView],
  templateUrl: './content-host.html',
  styleUrl: './content-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentHost {
  /**
   * Holds the tab registry whose views are rendered.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Gets the ordered list of open tabs.
   */
  protected readonly tabs: Signal<readonly Tab[]> = this.tabsService.tabs;

  /**
   * Gets the identifier of the active tab, or undefined when no tab is open.
   */
  protected readonly activeTabId: Signal<string | undefined> = this.tabsService.activeTabId;
}
