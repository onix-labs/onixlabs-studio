import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Icon } from '@shared/angular/icons/icon';
import {
  MENU_SEPARATOR,
  MenuContribution,
  MenuEntry,
} from '@shared/angular/services/app-menu/app-menu-model';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import {
  AiManagerNavigation,
  AiManagerSection,
} from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { Skills } from '@shared/angular/services/skills/skills';
import { AiLibraryCommands, AiLibrarySection } from '../ai-library-commands/ai-library-commands';
import { ModelManagerCommands } from '../model-manager-commands/model-manager-commands';
import { AiManagerAgentPanelState } from '../ai-manager-agent/ai-manager-agent-panel-state';

/**
 * The contextual ribbon shown while the AI Manager tab is active (#948). Its View group chooses the
 * sub-view — Local Models, Prompt Profiles or Skills — and the groups after it are that sub-view's:
 *
 * - **Local Models:** the runtime (Install, or Start/Stop, and Refresh), driving the sub-view through
 *   the {@link ModelManagerCommands} registry. Stop is disabled for a server Studio did not start —
 *   the user's own Ollama is reachable but not Studio's to kill.
 * - **Prompt Profiles / Skills:** New, through the {@link AiLibraryCommands} registry, since what a new
 *   entry is and which one is then selected belong to the sub-view; Skills also imports, opens the
 *   library folder and re-reads it.
 */
@Component({
  selector: 'app-ai-manager-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton],
  templateUrl: './ai-manager-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiManagerRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the section state the View group reads and sets.
   */
  private readonly navigation: AiManagerNavigation = inject(AiManagerNavigation);

  /**
   * Holds the registry the runtime buttons drive the Local Models sub-view through.
   */
  private readonly models: ModelManagerCommands = inject(ModelManagerCommands);

  /**
   * Holds the registry the library buttons call the shown sub-view through.
   */
  private readonly library: AiLibraryCommands = inject(AiLibraryCommands);

  /**
   * Holds the skill library, which the folder and refresh buttons act on directly.
   */
  private readonly skills: Skills = inject(Skills);

  /**
   * Holds whether the docked agent is showing (#967).
   */
  private readonly agentPanel: AiManagerAgentPanelState = inject(AiManagerAgentPanelState);

  /**
   * Gets whether the docked agent is showing.
   */
  protected readonly agentShown: Signal<boolean> = this.agentPanel.visible;

  /**
   * Gets the sub-view shown.
   */
  protected readonly section: Signal<AiManagerSection> = this.navigation.section;

  /**
   * Gets whether the runtime's server is running, choosing between Start and Stop.
   */
  protected readonly running: Signal<boolean> = this.models.running;

  /**
   * Gets whether the running server may be stopped by Studio.
   */
  protected readonly stoppable: Signal<boolean> = this.models.stoppable;

  /**
   * Gets whether a runtime operation is in flight, disabling the runtime actions.
   */
  protected readonly busy: Signal<boolean> = this.models.busy;

  /**
   * Gets whether the runtime is not installed, which turns Start into Install.
   */
  protected readonly needsInstall: Signal<boolean> = this.models.needsInstall;

  /**
   * Gets the library sub-views ready to take a command.
   */
  protected readonly registered: Signal<ReadonlySet<AiLibrarySection>> = this.library.registered;

  /**
   * Gets whether the skill library is being read.
   */
  protected readonly skillsLoading: Signal<boolean> = this.skills.loading;

  /**
   * Contributes this tab's menu for the sub-view shown while the ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu(
    'model-manager',
    (): readonly MenuContribution[] => {
      switch (this.section()) {
        case 'models':
          return [{ id: 'models', label: 'Models', items: this.modelItems() }];
        case 'profiles':
          return [
            {
              id: 'profiles',
              label: 'Profiles',
              items: [
                {
                  id: 'profiles.new',
                  label: 'New Profile',
                  enabled: this.registered().has('profiles'),
                  run: (): void => this.onAdd('profiles'),
                },
              ],
            },
          ];
        case 'skills':
          return [{ id: 'skills', label: 'Skills', items: this.skillItems() }];
      }
    },
  );

  /**
   * Shows a sub-view.
   * @param section The sub-view to show.
   */
  protected onShow(section: AiManagerSection): void {
    this.navigation.show(section);
  }

  /**
   * Reloads the models and the runtime's status.
   */
  protected onRefresh(): void {
    this.models.refresh();
  }

  /**
   * Starts the runtime's server.
   */
  protected onStart(): void {
    this.models.start();
  }

  /**
   * Stops the runtime's server.
   */
  protected onStop(): void {
    this.models.stop();
  }

  /**
   * Installs the runtime.
   */
  protected onInstall(): void {
    this.models.installRuntime();
  }

  /**
   * Starts a new entry in a library sub-view.
   * @param section The sub-view.
   */
  protected onAdd(section: AiLibrarySection): void {
    this.library.add(section);
  }

  /**
   * Imports a skill through the platform dialog.
   */
  protected onImportSkill(): void {
    this.library.importFrom('skills');
  }

  /**
   * Opens the skill library's folder.
   */
  protected onOpenSkillFolder(): void {
    void this.skills.openLibrary();
  }

  /**
   * Re-reads the skill library, for a user editing beside Studio.
   */
  protected onRefreshSkills(): void {
    void this.skills.reload();
  }

  /**
   * Shows or hides the docked agent.
   */
  protected onToggleAgent(): void {
    this.agentPanel.toggle();
  }

  /**
   * Builds the Models menu: the runtime's actions.
   * @returns Returns the items.
   */
  private modelItems(): readonly MenuEntry[] {
    return [
      {
        id: 'models.install',
        label: 'Install Runtime',
        enabled: this.needsInstall() && !this.busy(),
        run: (): void => this.onInstall(),
      },
      {
        id: 'models.start',
        label: 'Start Runtime',
        enabled: !this.running() && !this.busy(),
        run: (): void => this.onStart(),
      },
      {
        id: 'models.stop',
        label: 'Stop Runtime',
        enabled: this.stoppable() && !this.busy(),
        run: (): void => this.onStop(),
      },
      MENU_SEPARATOR,
      {
        id: 'models.refresh',
        label: 'Refresh',
        accelerator: 'CmdOrCtrl+Shift+R',
        run: (): void => this.onRefresh(),
      },
    ];
  }

  /**
   * Builds the Skills menu: new, import, and the library folder.
   * @returns Returns the items.
   */
  private skillItems(): readonly MenuEntry[] {
    return [
      {
        id: 'skills.new',
        label: 'New Skill',
        enabled: this.registered().has('skills'),
        run: (): void => this.onAdd('skills'),
      },
      {
        id: 'skills.import',
        label: 'Import Skill',
        enabled: this.registered().has('skills'),
        run: (): void => this.onImportSkill(),
      },
      MENU_SEPARATOR,
      {
        id: 'skills.open-folder',
        label: 'Open Skills Folder',
        run: (): void => this.onOpenSkillFolder(),
      },
      {
        id: 'skills.refresh',
        label: 'Refresh',
        enabled: !this.skillsLoading(),
        run: (): void => this.onRefreshSkills(),
      },
    ];
  }
}
