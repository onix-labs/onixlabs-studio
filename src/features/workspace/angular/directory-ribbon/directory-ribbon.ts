import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Signal,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { WorkspaceFind } from '@features/workspace/angular/workspace-find/workspace-find';
import { WorkspaceSourceControlCommands } from '@features/workspace/angular/workspace-source-control-commands/workspace-source-control-commands';
import { SourceControlCommands } from '@shared/angular/services/source-control-commands/source-control-commands';
import { ActiveRun, Builds } from '@shared/angular/services/tasks/builds';
import { Debugger } from '@shared/angular/services/debug/debugger';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { ConfigureDialog } from '@shared/angular/services/configure-dialog/configure-dialog';
import { WorkspaceCapabilities } from '@shared/angular/services/workspace/workspace-capabilities';
import { ProjectCapabilities, TargetAxis } from '@shared/api/project-system';
import {
  expandRunConfiguration,
  isCompoundConfiguration,
  RunConfiguration,
} from '@shared/api/studio';
import { Icon } from '@shared/angular/icons/icon';
import {
  LayoutPresetInfo,
  LayoutPresets,
} from '@shared/angular/services/layout-presets/layout-presets';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Modal } from '@shared/angular/components/modal/modal';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import {
  RibbonMenuItem,
  RibbonStripMenuButton,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { RibbonStripRow } from '@shared/angular/components/ribbon-strip/ribbon-strip-row/ribbon-strip-row';

/**
 * Represents the contextual ribbon shown when a directory tab is active. The Edit group routes edit
 * commands through the {@link EditorCommands} seam; the Solution Build and Run groups dispatch through
 * the {@link Builds} seam to the active workspace's build runner. The Run group is the Tier-1 universal
 * widget: a Start button that toggles to Stop while a run is in flight, a run-configuration dropdown
 * (sourced solely from the workspace's authored `.studio` configurations — nothing is inferred), a Debug
 * button that launches the selected configuration under the {@link Debugger} seam, and a Configure
 * button that opens the run-configuration editor. The Solution group's
 * Build/Rebuild/Clean and the Target group's configuration and target selectors gate themselves on the
 * active provider's declared {@link ProjectCapabilities}: unsupported actions are disabled, and the
 * Target group is hidden entirely when the provider declares no build-configuration or target axis. The
 * Source-Control group remains static scaffolding.
 */
@Component({
  selector: 'app-directory-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripMenuButton,
    RibbonStripField,
    RibbonStripRow,
    Dropdown,
    Modal,
  ],
  templateUrl: './directory-ribbon.html',
  styleUrl: './directory-ribbon.scss',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DirectoryRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the editor command seam the Edit group dispatches through.
   */
  private readonly commands: EditorCommands = inject(EditorCommands);

  /**
   * Holds the workspace find seam the Find command reveals the Search panel through.
   */
  private readonly workspaceFind: WorkspaceFind = inject(WorkspaceFind);

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
   * Gets whether the Target group is shown at all: only when the provider declares a build-configuration
   * or target axis (so, for example, an interpreted ecosystem shows no Target group).
   */
  protected readonly targetGroupVisible: Signal<boolean> = computed((): boolean => {
    const capabilities: ProjectCapabilities | null = this.capabilities();
    return (
      capabilities !== null &&
      (capabilities.buildConfigurations.length > 0 || capabilities.target !== null)
    );
  });

  /**
   * Gets the build-configuration names offered by the Configuration selector.
   */
  protected readonly buildConfigNames: Signal<readonly string[]> = computed(
    (): readonly string[] =>
      this.capabilities()?.buildConfigurations.map((configuration) => configuration.name) ?? [],
  );

  /**
   * Gets the display name of the selected build configuration.
   */
  protected readonly buildConfigValue: Signal<string> = computed((): string => {
    const capabilities: ProjectCapabilities | null = this.capabilities();
    const selectedId: string | undefined =
      this.studio.lastBuildConfiguration() ?? capabilities?.buildConfigurations[0]?.id;
    return (
      capabilities?.buildConfigurations.find((configuration) => configuration.id === selectedId)
        ?.name ?? ''
    );
  });

  /**
   * Gets the active provider's target axis, or null when it has none.
   */
  protected readonly targetAxis: Signal<TargetAxis | null> = computed(
    (): TargetAxis | null => this.capabilities()?.target ?? null,
  );

  /**
   * Gets the target-option names offered by the target selector.
   */
  protected readonly targetNames: Signal<readonly string[]> = computed(
    (): readonly string[] => this.targetAxis()?.options.map((option) => option.name) ?? [],
  );

  /**
   * Gets the display name of the selected target option.
   */
  protected readonly targetValue: Signal<string> = computed((): string => {
    const axis: TargetAxis | null = this.targetAxis();
    const selectedId: string | undefined = this.studio.lastTarget() ?? axis?.options[0]?.id;
    return axis?.options.find((option) => option.id === selectedId)?.name ?? '';
  });

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
   * Sends a build action to the active workspace's runner.
   * @param action The build action.
   * @param restart Whether a busy build may be stopped and replaced.
   */
  private dispatchBuildAction(action: 'build' | 'rebuild' | 'clean', restart: boolean): void {
    if (action === 'build') {
      this.builds.build({ restart });
    } else {
      this.builds.runAction(action, { restart });
    }
  }

  /**
   * Records the selected build configuration, mapping its display name back to its id.
   * @param name The chosen build configuration's display name.
   */
  protected onSelectBuildConfiguration(name: string): void {
    const id: string | undefined = this.capabilities()?.buildConfigurations.find(
      (configuration): boolean => configuration.name === name,
    )?.id;
    if (id !== undefined) {
      void this.studio.setLastBuildConfiguration(id);
    }
  }

  /**
   * Records the selected target option, mapping its display name back to its id.
   * @param name The chosen target option's display name.
   */
  protected onSelectTarget(name: string): void {
    const id: string | undefined = this.targetAxis()?.options.find(
      (option): boolean => option.name === name,
    )?.id;
    if (id !== undefined) {
      void this.studio.setLastTarget(id);
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
      this.debugger.launch(configuration);
    }
  }

  /**
   * Opens the Configure dialog to edit the workspace's run configurations.
   */
  protected onConfigure(): void {
    this.configureDialog.open();
  }

  /**
   * Stops everything the active workspace is running.
   */
  protected onStop(): void {
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
    this.sourceControl.openInSourceControl();
  }

  /**
   * Reveals the active workspace's commit panel.
   */
  protected onCommit(): void {
    this.sourceControl.commit();
  }

  /**
   * Pushes the active workspace's current branch.
   */
  protected onPush(): void {
    this.sourceControl.push();
  }

  /**
   * Pulls the active workspace's current branch.
   */
  protected onPull(): void {
    this.sourceControl.pull();
  }

  /**
   * Holds the repository command facade behind the Repository/Sync/Changes/Branch groups, served
   * by the active workspace's registered handler.
   */
  private readonly repositoryCommands: SourceControlCommands = inject(SourceControlCommands);

  /**
   * Re-reads the repository state.
   */
  protected onRepoRefresh(): void {
    this.repositoryCommands.refresh();
  }

  /**
   * Fetches from the remote without integrating.
   */
  protected onRepoFetch(): void {
    this.repositoryCommands.fetch();
  }

  /**
   * Stages every unstaged change.
   */
  protected onStageAll(): void {
    this.repositoryCommands.stageAll();
  }

  /**
   * Starts branch creation (the branches rail hosts the controls).
   */
  protected onNewBranch(): void {
    this.repositoryCommands.newBranch();
  }

  /**
   * Stashes the working tree.
   */
  protected onStash(): void {
    this.repositoryCommands.stash();
  }

  /**
   * Toggles the diff layout between inline and side-by-side.
   */
  protected onToggleDiff(): void {
    this.repositoryCommands.toggleInlineDiff();
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
   * Gets the layout presets as dropdown options.
   */
  protected readonly presetOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.layoutPresets
        .presets()
        .map(
          (preset: LayoutPresetInfo): DropdownOption => ({ value: preset.id, label: preset.name }),
        ),
  );

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
   * Gets a value indicating whether the active preset is a user preset, so Update, Rename, and
   * Delete apply (built-ins are immutable — forked with Save as…).
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
   * Holds which preset name prompt is open, or null when none is.
   */
  protected readonly presetPrompt: WritableSignal<'save-as' | 'rename' | null> = signal<
    'save-as' | 'rename' | null
  >(null);

  /**
   * Holds the name being edited in the preset prompt.
   */
  protected readonly presetPromptName: WritableSignal<string> = signal<string>('');

  /**
   * Holds the preset prompt's name input, focused when the prompt opens (the `autofocus` attribute
   * is unreliable on dynamically-inserted content and flagged for accessibility).
   */
  private readonly presetInput: Signal<ElementRef<HTMLInputElement> | undefined> =
    viewChild<ElementRef<HTMLInputElement>>('presetInput');

  /**
   * Initializes the ribbon, focusing the preset prompt's name input whenever the prompt opens.
   */
  public constructor() {
    effect((): void => {
      if (this.presetPrompt() !== null) {
        const input: HTMLInputElement | undefined = this.presetInput()?.nativeElement;
        if (input !== undefined) {
          setTimeout((): void => input.focus(), 0);
        }
      }
    });
  }

  /**
   * Applies the chosen layout preset to the active workspace.
   * @param id The chosen preset identifier.
   */
  protected onSelectPreset(id: string): void {
    this.layoutPresets.select(id);
  }

  /**
   * Opens the Save as… prompt for a new preset named after the current layout.
   */
  protected onSavePresetAs(): void {
    this.presetPromptName.set('');
    this.presetPrompt.set('save-as');
  }

  /**
   * Writes the current layout into the active user preset.
   */
  protected onUpdatePreset(): void {
    this.layoutPresets.updateActive();
  }

  /**
   * Opens the rename prompt for the active user preset.
   */
  protected onRenamePreset(): void {
    const active: LayoutPresetInfo | undefined = this.layoutPresets
      .presets()
      .find((preset: LayoutPresetInfo): boolean => preset.id === this.activePresetId());
    this.presetPromptName.set(active?.name ?? '');
    this.presetPrompt.set('rename');
  }

  /**
   * Deletes the active user preset; its workspaces fall back to the default preset.
   */
  protected onDeletePreset(): void {
    this.layoutPresets.remove(this.activePresetId());
  }

  /**
   * Re-applies the active preset's saved definition, discarding the session's layout tweaks.
   */
  protected onResetPreset(): void {
    this.layoutPresets.reset();
  }

  /**
   * Records the prompt's name as it is edited.
   * @param event The input event carrying the name.
   */
  protected onPresetPromptInput(event: Event): void {
    this.presetPromptName.set((event.target as HTMLInputElement).value);
  }

  /**
   * Confirms the open preset prompt: saving the current layout as a new preset, or renaming the
   * active one.
   */
  protected confirmPresetPrompt(): void {
    const name: string = this.presetPromptName().trim();
    const mode: 'save-as' | 'rename' | null = this.presetPrompt();
    this.presetPrompt.set(null);
    if (name.length === 0 || mode === null) {
      return;
    }
    if (mode === 'save-as') {
      this.layoutPresets.saveAs(name);
    } else {
      this.layoutPresets.rename(this.activePresetId(), name);
    }
  }

  /**
   * Dismisses the preset prompt without applying it.
   */
  protected cancelPresetPrompt(): void {
    this.presetPrompt.set(null);
  }
}
