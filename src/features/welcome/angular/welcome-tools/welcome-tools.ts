import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { PluginUpdates } from '@shared/angular/services/plugins/plugin-updates';
import { Chip } from '@shared/angular/components/chip/chip';
import { TabType } from '@shared/angular/services/tabs/tab';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';

/**
 * Describes one tool card.
 */
interface ToolCard {
  /**
   * Gets the tool's name.
   */
  readonly title: string;

  /**
   * Gets a sentence saying what the tool is for.
   */
  readonly description: string;

  /**
   * Gets the tool's icon.
   */
  readonly icon: Icon;

  /**
   * Gets the tab the tool opens, or null for a tool that does not exist yet.
   */
  readonly opens: TabType | null;
}

/**
 * The welcome screen's Tools section: "I want to manage the environment Studio runs in". A card per
 * tool, each opening it in its own tab.
 */
@Component({
  selector: 'app-welcome-tools',
  imports: [AppIcon, Chip, TooltipTrigger],
  templateUrl: './welcome-tools.html',
  styleUrl: './welcome-tools.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeTools {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Emits the kind of tab a card asks for; the welcome screen opens it and steps aside.
   */
  public readonly openTab: OutputEmitterRef<TabType> = output<TabType>();

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets how many installed plugins have an update waiting, shown as a chip on the Plugin Manager's
   * card: the welcome window stands in front of the main window, where the notification appears.
   */
  protected readonly updateCount: Signal<number> = computed(
    (): number => this.pluginUpdates.available().length,
  );

  /**
   * Holds the plugin-update check.
   */
  private readonly pluginUpdates: PluginUpdates = inject(PluginUpdates);

  /**
   * Gets the tool cards, in reading order.
   */
  protected readonly tools: readonly ToolCard[] = [
    {
      title: 'Containers',
      description:
        'Build, run and manage containerised applications with Docker and compatible runtimes.',
      icon: Icon.WELCOME_CONTAINERS,
      opens: 'containers',
    },
    {
      title: 'Orchestration',
      description: 'Manage distributed services and deployments across your environments.',
      icon: Icon.WELCOME_ORCHESTRATION,
      opens: null,
    },
    {
      title: 'AI Manager',
      description: 'Providers, local models, prompt profiles and skills, in one place.',
      icon: Icon.WELCOME_AI_MODELS,
      opens: 'model-manager',
    },
    {
      title: 'System Monitor',
      description: 'Watch system resources, Studio’s processes and its logs.',
      icon: Icon.WELCOME_SYSTEM_MONITOR,
      opens: 'system-monitor',
    },
    {
      title: 'Plugin Manager',
      description: 'Discover, install and manage the plugins that extend ONIXLabs Studio.',
      icon: Icon.WELCOME_TOOL_PLUGINS,
      opens: 'plugin-manager',
    },
    {
      title: 'Settings',
      description: 'Configure Studio’s preferences, providers and appearance.',
      icon: Icon.WELCOME_TOOL_SETTINGS,
      opens: 'settings',
    },
  ];

  /**
   * Opens a tool.
   * @param tool The tool's card.
   */
  protected open(tool: ToolCard): void {
    if (tool.opens === null) {
      // No feature behind this tool yet; it is sketched here to shape the screen.
      this.log.info('welcome', `"${tool.title}" is not available yet`);
      return;
    }
    this.log.info('welcome', `Open tool ${tool.opens}`);
    this.openTab.emit(tool.opens);
  }
}
