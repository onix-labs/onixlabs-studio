import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Signal,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { MENU_SEPARATOR, MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';
import { Log } from '@shared/angular/services/log/log';
import { WorkspaceFind } from '@features/workspace/angular/workspace-find/workspace-find';
import { WorkspaceDocumentCommands } from '@features/workspace/angular/workspace-document-commands/workspace-document-commands';
import { WorkspaceSourceControlCommands } from '@features/workspace/angular/workspace-source-control-commands/workspace-source-control-commands';
import { SourceControlCommands } from '@shared/angular/services/source-control-commands/source-control-commands';
import { ActiveRun, Builds } from '@shared/angular/services/tasks/builds';
import { Debugger } from '@shared/angular/services/debug/debugger';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { ConfigureDialog } from '@shared/angular/services/configure-dialog/configure-dialog';
import { WorkspaceCapabilities } from '@shared/angular/services/workspace/workspace-capabilities';
import { ProjectCapabilities } from '@shared/api/project-system';
import {
  expandRunConfiguration,
  isCompoundConfiguration,
  resolveDefaultRunConfiguration,
  RunConfiguration,
} from '@shared/api/studio';
import { Icon } from '@shared/angular/icons/icon';
import {
  LayoutPresetInfo,
  LayoutPresets,
} from '@shared/angular/services/layout-presets/layout-presets';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import {
  RibbonMenuItem,
  RibbonStripMenuButton,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Radio } from '@shared/angular/components/forms/radio/radio';

/**
 * Identifies the Save All item in the File group's Save split button menu.
 */
const SAVE_ALL: string = 'save-all';

/**
 * Identifies the Stash item in the Source Control group's Commit split button menu.
 */
const COMMIT_STASH: string = 'stash';

/**
 * Represents the contextual ribbon shown when a directory tab is active, in group order: File, Edit,
 * View, Run, Solution, Target (when the provider declares one), and Source Control.
 *
 * File saves the well's documents through the {@link WorkspaceDocumentCommands} seam — the well is
 * backed by a per-view documents service this shell-rendered ribbon cannot resolve directly. Edit
 * routes through the {@link EditorCommands} seam, and holds the document-level actions — the clipboard
 * trio, the history pair, and Find. View drives layout presets: the big button applies the DEFAULT
 * preset (named on its face) and its menu lists every preset, while Save, Save As and Manage write
 * them. Solution is the single group for launching the project. Start is a split button: its face runs
 * the workspace's default configuration (falling back to the effective selection) in one press, and its
 * chevron opens a dropdown of the workspace's authored `.studio` run configurations (nothing is
 * inferred), each coloured and glyphed by whether it is running — a running configuration is red and
 * stops on click, a stopped one is green and starts on click, both through the {@link Builds} seam. The
 * face flips to Stop, red-toned, as soon as anything is in flight, and cancels every run rather than
 * only what it started. Configure opens the run configurations dialog where those are authored. (The
 * Debug and Build/Rebuild/Clean seams remain wired on this component but are not currently surfaced,
 * pending where they land in the run-configuration model.) Source Control is the workspace's one-stop
 * git group, dispatching through the {@link SourceControlCommands} and
 * {@link WorkspaceSourceControlCommands} seams.
 */
@Component({
  selector: 'app-directory-ribbon',
  imports: [
    Radio,
    TextField,
    Button,
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripMenuButton,
    Checkbox,
    Modal,
    ModalContent,
  ],
  templateUrl: './directory-ribbon.html',
  styleUrl: './directory-ribbon.scss',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DirectoryRibbon {
  /**
   * Contributes this tab's menu while the workspace ribbon is mounted: the editing commands the
   * embedded editor offers, and the source-control and layout commands that belong to the workspace.
   */
  private readonly menu: void = contributeFeatureMenu(
    'directory',
    (): readonly MenuContribution[] => [
      {
        id: 'file',
        label: 'File',
        items: [
          {
            id: 'directory.save',
            label: 'Save',
            accelerator: 'CmdOrCtrl+S',
            run: (): void => this.onSave(),
          },
        ],
      },
      {
        id: 'edit',
        label: 'Edit',
        items: [
          {
            id: 'directory.undo',
            label: 'Undo',
            accelerator: 'CmdOrCtrl+Z',
            run: (): void => this.onUndo(),
          },
          {
            id: 'directory.redo',
            label: 'Redo',
            accelerator: 'CmdOrCtrl+Shift+Z',
            run: (): void => this.onRedo(),
          },
          MENU_SEPARATOR,
          {
            id: 'directory.cut',
            label: 'Cut',
            accelerator: 'CmdOrCtrl+X',
            run: (): void => this.onCut(),
          },
          {
            id: 'directory.copy',
            label: 'Copy',
            accelerator: 'CmdOrCtrl+C',
            run: (): void => this.onCopy(),
          },
          {
            id: 'directory.paste',
            label: 'Paste',
            accelerator: 'CmdOrCtrl+V',
            run: (): void => this.onPaste(),
          },
          MENU_SEPARATOR,
          {
            id: 'directory.find',
            label: 'Find…',
            accelerator: 'CmdOrCtrl+F',
            run: (): void => this.onFind(),
          },
        ],
      },
      {
        id: 'source-control',
        label: 'Source Control',
        items: [
          { id: 'directory.commit', label: 'Commit…', run: (): void => this.onCommit() },
          MENU_SEPARATOR,
          { id: 'directory.pull', label: 'Pull', run: (): void => this.onPull() },
          { id: 'directory.push', label: 'Push', run: (): void => this.onPush() },
          { id: 'directory.fetch', label: 'Fetch', run: (): void => this.onRepoFetch() },
          MENU_SEPARATOR,
          { id: 'directory.promote', label: 'Promote Worktree', run: (): void => this.onPromote() },
        ],
      },
      {
        id: 'view',
        label: 'View',
        items: [
          {
            id: 'directory.savePresetAs',
            label: 'Save Layout As…',
            run: (): void => this.onSavePresetAs(),
          },
          {
            id: 'directory.updatePreset',
            label: 'Update Layout',
            run: (): void => this.onUpdatePreset(),
          },
          {
            id: 'directory.managePresets',
            label: 'Manage Layouts…',
            run: (): void => this.onManagePresets(),
          },
          MENU_SEPARATOR,
          {
            id: 'directory.resetLayout',
            label: 'Reset Layout',
            run: (): void => this.onApplyDefaultPreset(),
          },
        ],
      },
    ],
  );

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the editor command seam the Edit group dispatches through.
   */
  private readonly commands: EditorCommands = inject(EditorCommands);

  /**
   * Holds the workspace find seam the Find command reveals the Search panel through.
   */
  private readonly workspaceFind: WorkspaceFind = inject(WorkspaceFind);

  /**
   * Holds the workspace document seam the File group's Save and Save All dispatch through.
   */
  private readonly workspaceDocuments: WorkspaceDocumentCommands =
    inject(WorkspaceDocumentCommands);

  /**
   * Gets whether the well has a document the Save action can write.
   */
  protected readonly canSave: Signal<boolean> = this.workspaceDocuments.canSave;

  /**
   * Gets whether the well holds unsaved changes, enabling Save All.
   */
  protected readonly hasUnsavedChanges: Signal<boolean> = this.workspaceDocuments.hasUnsavedChanges;

  /**
   * Gets the Save split button's menu: Save All, disabled while nothing is unsaved.
   */
  protected readonly saveMenuItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] => [
      {
        id: SAVE_ALL,
        label: 'Save All',
        icon: Icon.SAVE_ALL,
        disabled: !this.hasUnsavedChanges(),
      },
    ],
  );

  /**
   * Saves the well's active document.
   */
  protected onSave(): void {
    this.workspaceDocuments.save();
  }

  /**
   * Saves every document in the well with unsaved changes. Also bound to the workspace's Save
   * accelerator.
   */
  protected onSaveAll(): void {
    this.workspaceDocuments.saveAll();
  }

  /**
   * Handles a choice from the Save split button's menu.
   * @param id The chosen item's identifier.
   */
  protected onSaveMenuItem(id: string): void {
    if (id === SAVE_ALL) {
      this.onSaveAll();
    }
  }

  /**
   * Holds the build seam the Solution and Run groups dispatch through to the active workspace.
   */
  private readonly builds: Builds = inject(Builds);

  /**
   * Holds the debugger seam the Debug button launches the selected run configuration through.
   */
  private readonly debugger: Debugger = inject(Debugger);

  /**
   * Holds the active workspace's `.studio` configuration, the source of the run dropdown's items.
   */
  private readonly studio: StudioConfig = inject(StudioConfig);

  /**
   * Holds the active workspace's declared capabilities, gating the Solution and Target groups.
   */
  private readonly workspaceCapabilities: WorkspaceCapabilities = inject(WorkspaceCapabilities);

  /**
   * Holds the Configure dialog's open-state service, opened by the Run group's Configure button.
   */
  private readonly configureDialog: ConfigureDialog = inject(ConfigureDialog);

  /**
   * Gets the active workspace's declared capabilities, or null when none are available.
   */
  protected readonly capabilities: Signal<ProjectCapabilities | null> =
    this.workspaceCapabilities.capabilities;

  /**
   * Holds the run item the user has explicitly picked in the dropdown, or null to use the default.
   */
  private readonly picked: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the source-control seam the Source Control group dispatches through to the active workspace.
   */
  private readonly sourceControl: WorkspaceSourceControlCommands = inject(
    WorkspaceSourceControlCommands,
  );

  /**
   * Gets whether the active workspace's open folder is a git repository, enabling the Source Control
   * group's actions.
   */
  protected readonly hasRepository: Signal<boolean> = this.sourceControl.hasRepository;

  /**
   * Gets whether the active workspace supports Build: authoritative from the provider's declared
   * actions when a capability model exists, otherwise the discovered-task fallback so ecosystems
   * without a capability provider (Gradle, Make) still build.
   */
  protected readonly canBuild: Signal<boolean> = computed((): boolean => {
    const capabilities: ProjectCapabilities | null = this.capabilities();
    return capabilities !== null ? capabilities.actions.includes('build') : this.builds.canBuild();
  });

  /**
   * Gets whether the active workspace's provider declares the Clean action.
   */
  protected readonly canClean: Signal<boolean> = computed(
    (): boolean => this.capabilities()?.actions.includes('clean') ?? false,
  );

  /**
   * Gets whether the active workspace's provider declares the Rebuild action.
   */
  protected readonly canRebuild: Signal<boolean> = computed(
    (): boolean => this.capabilities()?.actions.includes('rebuild') ?? false,
  );

  /**
   * Gets whether the Solution group has anything to show. A workspace whose ecosystem has no build
   * step at all — Python, or a Node package whose manifest declares no build/clean scripts — would
   * otherwise carry a group of permanently disabled buttons, so the group disappears with its last
   * action instead.
   */
  protected readonly solutionGroupVisible: Signal<boolean> = computed(
    (): boolean => this.canBuild() || this.canRebuild() || this.canClean(),
  );

  /**
   * Gets whether the active workspace has anything running.
   */
  protected readonly running: Signal<boolean> = this.builds.running;

  /**
   * Gets whether the active workspace's Build terminal is busy. Build actions gate on this alone —
   * not on {@link running} — so a build can start while run configurations are in flight.
   */
  protected readonly buildBusy: Signal<boolean> = this.builds.buildBusy;

  /**
   * Holds the build action awaiting the user's stop-and-restart confirmation, or null when none is.
   * Set when a build action is requested while the Build terminal is busy; the modal it opens either
   * dispatches the action with restart granted or discards it.
   */
  protected readonly pendingBuildAction: WritableSignal<'build' | 'rebuild' | 'clean' | null> =
    signal<'build' | 'rebuild' | 'clean' | null>(null);

  /**
   * Holds the run configuration awaiting the user's stop-and-restart confirmation, or null when none
   * is. Set when Start targets a configuration whose run session (or a compound member's) is still
   * running; the modal it opens either relaunches with restart granted or leaves the run alone.
   */
  protected readonly pendingRunConfiguration: WritableSignal<RunConfiguration | null> =
    signal<RunConfiguration | null>(null);

  /**
   * Gets the active workspace's in-flight runs, listed by the Stop button's menu.
   */
  protected readonly activeRuns: Signal<readonly ActiveRun[]> = this.builds.activeRuns;

  /**
   * Gets the Stop button's label: stopping one run needs no qualification, but with several in flight
   * the big button is the "everything" button and says so.
   */
  protected readonly stopLabel: Signal<string> = computed((): string =>
    this.activeRuns().length > 1 ? `Stop All (${this.activeRuns().length})` : 'Stop',
  );

  /**
   * Gets the Stop menu's items, one per in-flight run, so a single run can be stopped without stopping
   * the rest. Runs of the same configuration are numbered in launch order, since their labels alone
   * would not tell them apart.
   */
  protected readonly runMenuItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] => {
      const runs: readonly ActiveRun[] = this.activeRuns();
      const counts: Map<string, number> = new Map<string, number>();
      for (const run of runs) {
        counts.set(run.taskId, (counts.get(run.taskId) ?? 0) + 1);
      }
      const seen: Map<string, number> = new Map<string, number>();
      return runs.map((run: ActiveRun): RibbonMenuItem => {
        const ordinal: number = (seen.get(run.taskId) ?? 0) + 1;
        seen.set(run.taskId, ordinal);
        const duplicated: boolean = (counts.get(run.taskId) ?? 0) > 1;
        // Deliberately iconless: the stop glyph is a filled square, which in a menu column reads as an
        // unticked checkbox rather than an action.
        return { id: run.id, label: duplicated ? `${run.label} (${ordinal})` : run.label };
      });
    },
  );

  /**
   * Gets the run configurations offered by the dropdown: the workspace's authored `.studio`
   * configurations, and nothing else. Studio never infers what a workspace should run, so a workspace
   * with no configurations offers none.
   */
  protected readonly runOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.studio.runConfigurations().map(
        (configuration: RunConfiguration): DropdownOption => ({
          value: configuration.id,
          label: configuration.name,
        }),
      ),
  );

  /**
   * Gets the id of the effective selected run configuration: the user's pick when it is still offered,
   * otherwise the persisted `.studio` selection, or null when the workspace has no configurations.
   */
  protected readonly selectedRunId: Signal<string | null> = computed((): string | null => {
    const options: readonly DropdownOption[] = this.runOptions();
    if (options.length === 0) {
      return null;
    }
    const picked: DropdownOption | undefined = options.find(
      (option: DropdownOption): boolean => option.value === this.picked(),
    );
    if (picked !== undefined) {
      return picked.value;
    }
    return this.studio.selectedRunConfiguration()?.id ?? options[0].value;
  });

  /**
   * Gets whether there is a run configuration the Start action can launch.
   */
  protected readonly canRun: Signal<boolean> = computed(
    (): boolean => this.selectedRunId() !== null,
  );

  /**
   * Gets the Actions dropdown's rows: one per authored run configuration, coloured and glyphed by
   * whether it is currently running. A running configuration is red and wears the stop glyph — choosing
   * it stops it; a stopped one is green and wears the start glyph — choosing it starts it. Compounds
   * count as running when any of their resolved members is.
   */
  protected readonly actionItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] =>
      this.studio.runConfigurations().map((configuration: RunConfiguration): RibbonMenuItem => {
        const running: boolean = this.isConfigurationRunning(configuration);
        return {
          id: configuration.id,
          label: configuration.name,
          status: running ? '(running)' : '(stopped)',
          icon: running ? Icon.STOP : Icon.PLAY,
          tone: running ? 'danger' : 'success',
        };
      }),
  );

  /**
   * Gets whether there are any run configurations for the Start button to list. It is disabled when
   * the workspace has authored none — Configure is then the way to create the first.
   */
  protected readonly hasActions: Signal<boolean> = computed(
    (): boolean => this.studio.runConfigurations().length > 0,
  );

  /**
   * Gets whether the workspace is running anything at all, which flips the Solution group's Start button
   * into its Stop state. Deliberately "anything", not "the configuration the face would start": once a
   * run is in flight the single big button is how the user stops it, whichever configuration — or
   * dropdown row — started it.
   */
  protected readonly anyRunning: Signal<boolean> = computed(
    (): boolean => this.activeRuns().length > 0,
  );

  /**
   * Gets the configuration the Start button's face launches: the workspace's flagged default, falling
   * back to the effective selection. Most workspaces flag no default (the flag is opt-in), and a Start
   * button that were dead until someone set one would be worse than one that starts the configuration
   * the workspace already considers current — so the fallback keeps the single press meaningful, and
   * flagging a default simply pins which one it is.
   */
  private readonly startConfiguration: Signal<RunConfiguration | undefined> = computed(
    (): RunConfiguration | undefined =>
      resolveDefaultRunConfiguration(this.studio.runConfigurations()) ??
      this.selectedConfiguration(),
  );

  /**
   * Gets the selected `.studio` run configuration, or undefined when the workspace has none. Both Start
   * and Debug launch this one.
   */
  private readonly selectedConfiguration: Signal<RunConfiguration | undefined> = computed(
    (): RunConfiguration | undefined => {
      const id: string | null = this.selectedRunId();
      return id === null
        ? undefined
        : this.studio
            .runConfigurations()
            .find((candidate: RunConfiguration): boolean => candidate.id === id);
    },
  );

  /**
   * Gets whether the Debug button can launch: the active provider declares a debug adapter, a run
   * configuration is selected, and no debug session is already running. Providers that declare no
   * adapter (or none at all) leave the button disabled rather than launching a session that would
   * immediately report it has nowhere to attach.
   */
  protected readonly canDebug: Signal<boolean> = computed((): boolean => {
    const configuration: RunConfiguration | undefined = this.selectedConfiguration();
    return (
      this.capabilities()?.debug != null &&
      configuration !== undefined &&
      // A compound starts several processes; there is no single program to attach to.
      !isCompoundConfiguration(configuration) &&
      !this.debugger.running()
    );
  });

  /**
   * Cuts the selection in the focused editor.
   */
  protected onCut(): void {
    this.commands.cut();
  }

  /**
   * Copies the selection in the focused editor.
   */
  protected onCopy(): void {
    this.commands.copy();
  }

  /**
   * Pastes into the focused editor.
   */
  protected onPaste(): void {
    this.commands.paste();
  }

  /**
   * Undoes the last edit in the focused editor.
   */
  protected onUndo(): void {
    this.commands.undo();
  }

  /**
   * Redoes the last undone edit in the focused editor.
   */
  protected onRedo(): void {
    this.commands.redo();
  }

  /**
   * Reveals the workspace's multi-file Search panel.
   */
  protected onFind(): void {
    this.log.info('workspace.ribbon', 'Find in Files invoked');
    this.workspaceFind.reveal();
  }

  /**
   * Runs the active workspace's default build task.
   */
  protected onBuild(): void {
    this.requestBuildAction('build');
  }

  /**
   * Cleans the active workspace's build outputs.
   */
  protected onClean(): void {
    this.requestBuildAction('clean');
  }

  /**
   * Rebuilds the active workspace from clean.
   */
  protected onRebuild(): void {
    this.requestBuildAction('rebuild');
  }

  /**
   * Starts the selected run configuration, or — when it (or one of a compound's members) is still
   * running — asks whether to stop it and start again (a running program is never killed silently).
   */
  protected onRun(): void {
    const configuration: RunConfiguration | undefined = this.selectedConfiguration();
    if (configuration === undefined) {
      return;
    }
    if (this.isConfigurationRunning(configuration)) {
      this.pendingRunConfiguration.set(configuration);
      return;
    }
    this.log.info('workspace.run', 'Run configuration started', configuration.name);
    this.builds.runConfiguration(configuration, this.studio.runConfigurations(), {
      restart: false,
    });
  }

  /**
   * Confirms the run stop-and-restart prompt: the running program is stopped and the configuration
   * launches again in the same session.
   */
  protected confirmRunRestart(): void {
    const configuration: RunConfiguration | null = this.pendingRunConfiguration();
    this.pendingRunConfiguration.set(null);
    if (configuration !== null) {
      this.log.info('workspace.run', 'Run configuration restarted', configuration.name);
      this.builds.runConfiguration(configuration, this.studio.runConfigurations(), {
        restart: true,
      });
    }
  }

  /**
   * Dismisses the run stop-and-restart prompt, leaving the running program untouched.
   */
  protected cancelRunRestart(): void {
    this.pendingRunConfiguration.set(null);
  }

  /**
   * Determines whether a configuration is currently running: any in-flight run belongs to it (or, for
   * a compound, to one of its resolved members).
   * @param configuration The configuration to test.
   * @returns Returns true when the configuration has a run in flight.
   */
  private isConfigurationRunning(configuration: RunConfiguration): boolean {
    const leafIds: ReadonlySet<string> = new Set<string>(
      expandRunConfiguration(configuration, this.studio.runConfigurations()).map(
        (leaf: RunConfiguration): string => leaf.id,
      ),
    );
    return this.activeRuns().some((run): boolean => leafIds.has(run.taskId));
  }

  /**
   * Dispatches a build action, or — when the Build terminal is busy — asks whether to stop the
   * running build and start this one instead (a busy build is never killed silently).
   * @param action The requested build action.
   */
  private requestBuildAction(action: 'build' | 'rebuild' | 'clean'): void {
    if (this.builds.buildBusy()) {
      this.pendingBuildAction.set(action);
      return;
    }
    this.dispatchBuildAction(action, false);
  }

  /**
   * Confirms the stop-and-restart prompt: the running build is stopped and the pending action starts
   * in its place.
   */
  protected confirmBuildRestart(): void {
    const action: 'build' | 'rebuild' | 'clean' | null = this.pendingBuildAction();
    this.pendingBuildAction.set(null);
    if (action !== null) {
      this.dispatchBuildAction(action, true);
    }
  }

  /**
   * Dismisses the stop-and-restart prompt, leaving the running build untouched.
   */
  protected cancelBuildRestart(): void {
    this.pendingBuildAction.set(null);
  }

  /**
   * Sends a build action to the active workspace's runner. A declared action runs its ecosystem's own
   * command, so what the button dispatches is the action the provider declared — npm's Build runs the
   * `build` script it declared the action from, rather than whichever discovered task merely looked
   * build-shaped. Build alone falls back to the discovered default build task, which is what carries
   * ecosystems with no capability provider at all.
   * @param action The build action.
   * @param restart Whether a busy build may be stopped and replaced.
   */
  private dispatchBuildAction(action: 'build' | 'rebuild' | 'clean', restart: boolean): void {
    this.log.info('workspace.run', 'Build action dispatched', action, { restart });
    if (this.capabilities()?.actions.includes(action) === true) {
      this.builds.runAction(action, { restart });
    } else if (action === 'build') {
      this.builds.build({ restart });
    }
  }

  /**
   * Picks the chosen run configuration from the dropdown, persisting the choice.
   * @param id The id of the chosen run configuration.
   */
  protected onSelectRunItem(id: string): void {
    this.picked.set(id);
    if (this.studio.runConfigurations().some((c: RunConfiguration): boolean => c.id === id)) {
      void this.studio.setSelectedRunConfiguration(id);
    }
  }

  /**
   * Launches the selected run configuration under the debugger on the active workspace.
   */
  protected onDebug(): void {
    const configuration: RunConfiguration | undefined = this.selectedConfiguration();
    if (configuration !== undefined) {
      this.log.info('workspace.run', 'Debug launch requested', configuration.name);
      this.debugger.launch(configuration);
    }
  }

  /**
   * Opens the Configure dialog to edit the workspace's run configurations.
   */
  protected onConfigure(): void {
    this.log.info('workspace.run', 'Configure run configurations dialog opened');
    this.configureDialog.open();
  }

  /**
   * Acts on the Solution group's Start button face: stops everything when the workspace is running
   * anything, and otherwise launches {@link startConfiguration}. No stop-and-restart prompt can arise —
   * the two states are exclusive, so the face never starts a configuration while a run is in flight, and
   * the Stop half is itself the explicit stop.
   */
  protected onStartStop(): void {
    if (this.anyRunning()) {
      this.onStop();
      return;
    }
    const configuration: RunConfiguration | undefined = this.startConfiguration();
    if (configuration === undefined) {
      return;
    }
    this.log.info('workspace.run', 'Run configuration started', configuration.name);
    this.builds.runConfiguration(configuration, this.studio.runConfigurations(), {
      restart: false,
    });
  }

  /**
   * Toggles a run configuration chosen from the Start dropdown: a running configuration is stopped, a
   * stopped one is started. Starting only ever happens from a stopped state, so no stop-and-restart
   * prompt is needed — choosing a running row is itself the explicit stop.
   * @param id The chosen configuration's id.
   */
  protected onActionItem(id: string): void {
    const configuration: RunConfiguration | undefined = this.studio
      .runConfigurations()
      .find((candidate: RunConfiguration): boolean => candidate.id === id);
    if (configuration === undefined) {
      return;
    }
    if (this.isConfigurationRunning(configuration)) {
      this.stopConfiguration(configuration);
    } else {
      this.builds.runConfiguration(configuration, this.studio.runConfigurations(), {
        restart: false,
      });
    }
  }

  /**
   * Stops every in-flight run belonging to a configuration (or, for a compound, to any of its resolved
   * members), leaving other configurations' runs untouched.
   * @param configuration The configuration to stop.
   */
  private stopConfiguration(configuration: RunConfiguration): void {
    const leafIds: ReadonlySet<string> = new Set<string>(
      expandRunConfiguration(configuration, this.studio.runConfigurations()).map(
        (leaf: RunConfiguration): string => leaf.id,
      ),
    );
    for (const run of this.activeRuns()) {
      if (leafIds.has(run.taskId)) {
        this.builds.cancel(run.id);
      }
    }
  }

  /**
   * Stops everything the active workspace is running.
   */
  protected onStop(): void {
    this.log.info('workspace.run', 'Stop all runs requested', this.activeRuns().length);
    this.builds.cancelAll();
  }

  /**
   * Stops one in-flight run, chosen from the Stop button's menu, leaving the others running.
   * @param runId The run to stop.
   */
  protected onStopRun(runId: string): void {
    this.builds.cancel(runId);
  }

  /**
   * Opens the active workspace's repository in the full source-control view.
   */
  protected onOpenSourceControl(): void {
    this.log.info('source-control', 'Open in Source Control invoked');
    this.sourceControl.openInSourceControl();
  }

  /**
   * Reveals the active workspace's commit panel.
   */
  protected onCommit(): void {
    this.log.info('source-control', 'Commit invoked');
    this.sourceControl.commit();
  }

  /**
   * Pushes the active workspace's current branch.
   */
  protected onPush(): void {
    this.log.info('source-control', 'Push invoked');
    this.sourceControl.push();
  }

  /**
   * Pulls the active workspace's current branch.
   */
  protected onPull(): void {
    this.log.info('source-control', 'Pull invoked');
    this.sourceControl.pull();
  }

  /**
   * Holds the repository command facade behind the Source Control group, served by the active
   * workspace's registered handler.
   */
  private readonly repositoryCommands: SourceControlCommands = inject(SourceControlCommands);

  /**
   * Fetches from the remote without integrating.
   */
  protected onRepoFetch(): void {
    this.log.info('source-control', 'Fetch invoked');
    this.repositoryCommands.fetch();
  }

  /**
   * Gets the Commit split button's menu: setting the working tree aside instead of committing it.
   * Staging is deliberately absent — a commit resets the index and stages exactly the files checked
   * in the Commit panel, so staging beforehand cannot change what a commit contains.
   */
  protected readonly commitMenuItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] => [{ id: COMMIT_STASH, label: 'Stash', icon: Icon.STASH }],
  );

  /**
   * Handles a choice from the Commit split button's menu.
   * @param id The chosen item's identifier.
   */
  protected onCommitMenuItem(id: string): void {
    if (id === COMMIT_STASH) {
      this.onStash();
    }
  }

  /**
   * Stashes the working tree.
   */
  protected onStash(): void {
    this.log.info('source-control', 'Stash invoked');
    this.repositoryCommands.stash();
  }

  /**
   * Gets whether the active view can promote its repository into a worktree container (an ordinary
   * repository workspace can; a checkout inside a container cannot).
   */
  protected readonly canPromote: Signal<boolean> = this.repositoryCommands.canPromoteToWorktree;

  /**
   * Holds whether the promote confirmation is open.
   */
  protected readonly promoteConfirmOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Opens the promote confirmation: promotion restructures the folder on disk, so it is never run
   * from a bare button press.
   */
  protected onPromote(): void {
    this.promoteConfirmOpen.set(true);
  }

  /**
   * Confirms the promotion.
   */
  protected confirmPromote(): void {
    this.promoteConfirmOpen.set(false);
    this.log.info('source-control', 'Promote to worktree confirmed');
    this.repositoryCommands.promoteToWorktree();
  }

  /**
   * Cancels the promotion.
   */
  protected cancelPromote(): void {
    this.promoteConfirmOpen.set(false);
  }

  /**
   * Holds the layout preset store the View group's commands dispatch through.
   */
  private readonly layoutPresets: LayoutPresets = inject(LayoutPresets);

  /**
   * Gets every layout preset, for the View split button's menu and the Manage dialog's list.
   */
  protected readonly presets: Signal<readonly LayoutPresetInfo[]> = this.layoutPresets.presets;

  /**
   * Gets the View split button's menu: every preset, with the one currently showing marked. Choosing
   * one applies it to this workspace; which preset is the DEFAULT is set in the Manage dialog (or
   * when saving one), not by merely switching to it.
   */
  protected readonly presetMenuItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] =>
      this.presets().map(
        (preset: LayoutPresetInfo): RibbonMenuItem => ({
          id: preset.id,
          label: preset.name,
          active: preset.id === this.activePresetId(),
        }),
      ),
  );

  /**
   * Gets the default preset's display name, shown on the face of the View group's big button. A
   * default always exists as long as any preset does, so the fallback covers only the moment before
   * any view has registered its built-ins.
   */
  protected readonly defaultPresetName: Signal<string> = computed(
    (): string => this.layoutPresets.defaultPreset()?.name ?? 'Layout',
  );

  /**
   * Gets the default preset's identifier, so the Manage dialog can mark it.
   */
  protected readonly defaultPresetId: Signal<string | null> = this.layoutPresets.defaultId;

  /**
   * Gets the active preset's identifier, or the empty string while no workspace view is registered.
   */
  protected readonly activePresetId: Signal<string> = computed(
    (): string => this.layoutPresets.activeId() ?? '',
  );

  /**
   * Gets a value indicating whether preset commands can act: a workspace view is registered with a
   * root open.
   */
  protected readonly canUsePresets: Signal<boolean> = computed(
    (): boolean => this.layoutPresets.activeRoot() !== null,
  );

  /**
   * Gets a value indicating whether the active preset is a user preset, so Save (overwrite) applies
   * to it (built-ins are immutable — forked with Save As).
   */
  protected readonly canModifyPreset: Signal<boolean> = this.layoutPresets.activeIsUserPreset;

  /**
   * Gets a value indicating whether a transient (contextual) preset switch is active, showing the
   * Return affordance.
   */
  protected readonly presetTransient: Signal<boolean> = this.layoutPresets.transientActive;

  /**
   * Returns from the transient preset switch to the preset it left.
   */
  protected onReturnPreset(): void {
    this.layoutPresets.returnFromTransient();
  }

  /**
   * Holds whether the Save As dialog is open.
   */
  protected readonly saveAsOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the name being entered in the Save As dialog.
   */
  protected readonly saveAsName: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether the Save As dialog's Default box is ticked, making the saved preset the new
   * app-wide default and replacing the previous one.
   */
  protected readonly saveAsDefault: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the Manage dialog is open.
   */
  protected readonly manageOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the Save As dialog's name input, focused when the dialog opens (the `autofocus` attribute
   * is unreliable on dynamically-inserted content and flagged for accessibility).
   */
  private readonly presetInput: Signal<TextField | undefined> = viewChild<TextField>('presetInput');

  /**
   * Initializes the ribbon, focusing the Save As dialog's name input whenever it opens.
   */
  public constructor() {
    effect((): void => {
      if (this.saveAsOpen()) {
        const field: TextField | undefined = this.presetInput();
        if (field !== undefined) {
          setTimeout((): void => field.focus(), 0);
        }
      }
    });
  }

  /**
   * Applies the default layout preset — the View group's big button. Applying re-seeds the dock from
   * the preset's saved definition, so this doubles as the way back from a session's layout tweaks.
   */
  protected onApplyDefaultPreset(): void {
    const id: string | null = this.defaultPresetId();
    if (id !== null) {
      this.layoutPresets.select(id);
    }
  }

  /**
   * Applies the chosen layout preset to the active workspace.
   * @param id The chosen preset identifier.
   */
  protected onSelectPreset(id: string): void {
    this.log.debug('workspace.ribbon', 'Layout preset selected', id);
    this.layoutPresets.select(id);
  }

  /**
   * Writes the current layout into the active user preset.
   */
  protected onUpdatePreset(): void {
    this.layoutPresets.updateActive();
  }

  /**
   * Opens the Save As dialog for a new preset capturing the current layout.
   */
  protected onSavePresetAs(): void {
    this.saveAsName.set('');
    this.saveAsDefault.set(false);
    this.saveAsOpen.set(true);
  }

  /**
   * Confirms the Save As dialog, saving the current layout as a new preset and — when the box is
   * ticked — making it the default.
   */
  protected confirmSaveAs(): void {
    const name: string = this.saveAsName().trim();
    if (name.length === 0) {
      return;
    }
    this.saveAsOpen.set(false);
    this.log.info('workspace.ribbon', 'Layout preset saved as', name, {
      default: this.saveAsDefault(),
    });
    this.layoutPresets.saveAs(name, this.saveAsDefault());
  }

  /**
   * Dismisses the Save As dialog without saving.
   */
  protected cancelSaveAs(): void {
    this.saveAsOpen.set(false);
  }

  /**
   * Opens the Manage dialog, where presets are renamed, deleted, and marked as the default.
   */
  protected onManagePresets(): void {
    this.manageOpen.set(true);
  }

  /**
   * Closes the Manage dialog. Its edits apply as they are made, so there is nothing to confirm.
   */
  protected closeManage(): void {
    this.manageOpen.set(false);
  }

  /**
   * Makes a preset the default from the Manage dialog, replacing the previous one.
   * @param id The preset identifier.
   */
  protected onSetDefaultPreset(id: string): void {
    this.layoutPresets.setDefault(id);
  }

  /**
   * Renames a user preset from the Manage dialog. An empty name is ignored by the store, so clearing
   * the field leaves the preset named as it was.
   * @param id The preset identifier.
   * @param name The new display name.
   */
  protected onRenamePreset(id: string, name: string): void {
    this.layoutPresets.rename(id, name);
  }

  /**
   * Deletes a user preset from the Manage dialog; workspaces showing it fall back to the default.
   * @param id The preset identifier.
   */
  protected onDeletePreset(id: string): void {
    this.layoutPresets.remove(id);
  }

  /**
   * Re-applies the showing preset's saved definition, discarding the session's layout tweaks. Offered
   * from the Manage dialog, since the ribbon's own Reset button gave way to Manage.
   */
  protected onResetPreset(): void {
    this.layoutPresets.reset();
  }
}
