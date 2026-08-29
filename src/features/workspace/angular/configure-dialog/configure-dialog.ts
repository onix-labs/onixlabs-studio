import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { Log } from '@shared/angular/services/log/log';
import { ConfigureDialog } from '@shared/angular/services/configure-dialog/configure-dialog';
import { WorkspaceCapabilities } from '@shared/angular/services/workspace/workspace-capabilities';
import { RunConfiguration } from '@shared/api/studio';
import { Icon } from '@shared/angular/icons/icon';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { Button } from '@shared/angular/components/forms/button/button';
import { Textarea } from '@shared/angular/components/forms/textarea/textarea';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { runConfigurationKindLabel } from './run-configuration-kinds';

/**
 * A group of run configurations sharing a provider kind, shown as a collapsible parent row in the
 * dialog's tree.
 */
interface ConfigurationGroup {
  /**
   * Gets the provider kind the group's configurations belong to.
   */
  readonly kind: string;

  /**
   * Gets the group's configurations.
   */
  readonly configurations: readonly RunConfiguration[];
}

/**
 * The payload a Configure-dialog tree row carries, read by the projected row template. A row is
 * either a provider-kind group or one configuration beneath it.
 */
export interface ConfigurationRow {
  /**
   * Gets the label the row shows.
   */
  readonly label: string;

  /**
   * Gets a value indicating whether the row is a provider-kind group rather than a configuration.
   */
  readonly isGroup: boolean;

  /**
   * Gets the configuration the row stands for, or null for a group row.
   */
  readonly configuration: RunConfiguration | null;
}

/**
 * Prefixes distinguishing the two row kinds in the tree's flat id space, which has to be unique
 * across both: a group keyed by its provider kind, a configuration by its own id.
 */
const GROUP_PREFIX: string = 'group:';
const CONFIGURATION_PREFIX: string = 'config:';

/**
 * The run-configuration Configure dialog: a master-detail editor over the active workspace's `.studio`
 * run configurations. The tree on the left groups them by provider kind and carries its own New,
 * Duplicate and Delete controls; the form on the right edits the selected configuration's name, build
 * configuration and target (shown only when the provider declares them), program, arguments, working
 * directory, environment variables, and whether it runs or debugs. Edits are made against a draft copy
 * taken when the dialog opens, so Cancel discards them and Save writes the whole set back to
 * `workspace.json` through {@link StudioConfig}.
 *
 * Auto-configure — where the workspace's own agent is asked to author configurations — opens as its own
 * modal raised from this one, so it parents to this window rather than reaching past it to the main
 * window. Its content is still to be designed; the agent seam it will drive
 * ({@link import('@features/workspace/angular/run-configuration-agent/run-configuration-agent').RunConfigurationAgent})
 * is untouched and unwired in the meantime.
 */
@Component({
  selector: 'app-configure-dialog',
  imports: [
    Textarea,
    Button,
    Modal,
    ModalContent,
    Dropdown,
    SettingRow,
    TextField,
    Toggle,
    TreeView,
  ],
  templateUrl: './configure-dialog.html',
  styleUrl: './configure-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigureDialogPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the dialog's open-state service.
   */
  protected readonly dialog: ConfigureDialog = inject(ConfigureDialog);

  /**
   * Holds the active workspace's `.studio` configuration, the source and sink of the run configurations.
   */
  private readonly studio: StudioConfig = inject(StudioConfig);

  /**
   * Holds the active workspace's capabilities and kind, gating the build-configuration and target
   * selectors and binding a new configuration to the active ecosystem.
   */
  private readonly workspaceCapabilities: WorkspaceCapabilities = inject(WorkspaceCapabilities);

  /**
   * Holds the working copy of the run configurations, edited while the dialog is open and written back
   * on Save.
   */
  private readonly draft: WritableSignal<readonly RunConfiguration[]> = signal<
    readonly RunConfiguration[]
  >([]);

  /**
   * Holds the id of the selected configuration, or null when none is selected.
   */
  private readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether the Auto-configure modal is open. It is raised from inside this dialog's own content
   * so it parents to this window and dims it, rather than reaching past it to the main window.
   */
  protected readonly autoConfigureOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the provider kinds whose groups are collapsed. Collapsed rather than expanded is tracked so
   * a group the agent adds while the dialog is open arrives open, showing what landed.
   */
  private readonly collapsedKinds: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Gets whether the dialog is open.
   */
  protected readonly isOpen: Signal<boolean> = this.dialog.isOpen;

  /**
   * Gets the working configurations grouped by provider kind, for the list.
   */
  protected readonly groups: Signal<readonly ConfigurationGroup[]> = computed(
    (): readonly ConfigurationGroup[] => {
      const byKind: Map<string, RunConfiguration[]> = new Map<string, RunConfiguration[]>();
      for (const configuration of this.draft()) {
        const existing: RunConfiguration[] = byKind.get(configuration.providerKind) ?? [];
        existing.push(configuration);
        byKind.set(configuration.providerKind, existing);
      }
      return [...byKind.entries()].map(
        ([kind, configurations]: [string, RunConfiguration[]]): ConfigurationGroup => ({
          kind,
          configurations,
        }),
      );
    },
  );

  /**
   * Gets the tree's flattened rows: each provider-kind group followed by its configurations, with a
   * collapsed group contributing its own row and none beneath it.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const collapsed: ReadonlySet<string> = this.collapsedKinds();
    const rows: TreeRow[] = [];
    for (const group of this.groups()) {
      const expanded: boolean = !collapsed.has(group.kind);
      rows.push({
        id: `${GROUP_PREFIX}${group.kind}`,
        depth: 0,
        expandable: true,
        expanded,
        data: {
          label: runConfigurationKindLabel(group.kind),
          isGroup: true,
          configuration: null,
        } satisfies ConfigurationRow,
      });
      if (!expanded) {
        continue;
      }
      for (const configuration of group.configurations) {
        rows.push({
          id: `${CONFIGURATION_PREFIX}${configuration.id}`,
          depth: 1,
          expandable: false,
          expanded: false,
          data: {
            label: configuration.name,
            isGroup: false,
            configuration,
          } satisfies ConfigurationRow,
        });
      }
    }
    return rows;
  });

  /**
   * Gets the tree's selected row id, which is the selected configuration's row rather than its bare
   * id — the tree's id space spans groups and configurations alike.
   */
  protected readonly selectedRowId: Signal<string | null> = computed((): string | null => {
    const id: string | null = this.selectedId();
    return id === null ? null : `${CONFIGURATION_PREFIX}${id}`;
  });

  /**
   * Gets the selected configuration, or null when none is selected.
   */
  protected readonly selected: Signal<RunConfiguration | null> = computed(
    (): RunConfiguration | null =>
      this.draft().find(
        (configuration: RunConfiguration): boolean => configuration.id === this.selectedId(),
      ) ?? null,
  );

  /**
   * Gets the build-configuration options offered by the detail form, or an empty list when the provider
   * has none.
   */
  protected readonly buildConfigOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.workspaceCapabilities
        .capabilities()
        ?.buildConfigurations.map((configuration): DropdownOption => ({
          value: configuration.id,
          label: configuration.name,
        })) ?? [],
  );

  /**
   * Gets the target options offered by the detail form, or an empty list when the provider has none.
   */
  protected readonly targetOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.workspaceCapabilities
        .capabilities()
        ?.target?.options.map((option): DropdownOption => ({
          value: option.id,
          label: option.name,
        })) ?? [],
  );

  /**
   * Gets the label for the target selector (the provider's target-axis label), defaulting to `Target`.
   */
  protected readonly targetLabel: Signal<string> = computed(
    (): string => this.workspaceCapabilities.capabilities()?.target?.label ?? 'Target',
  );

  /**
   * Gets whether the build-configuration selector is shown.
   */
  protected readonly hasBuildConfigs: Signal<boolean> = computed(
    (): boolean => this.buildConfigOptions().length > 0,
  );

  /**
   * Gets whether the target selector is shown.
   */
  protected readonly hasTarget: Signal<boolean> = computed(
    (): boolean => this.workspaceCapabilities.capabilities()?.target != null,
  );

  /**
   * Gets the selected configuration's arguments as a single space-joined string, for the arguments
   * field.
   */
  protected readonly argsText: Signal<string> = computed(
    (): string => this.selected()?.args?.join(' ') ?? '',
  );

  /**
   * Gets the selected configuration's environment as `KEY=value` lines, for the environment field.
   */
  protected readonly envText: Signal<string> = computed((): string =>
    Object.entries(this.selected()?.env ?? {})
      .map(([key, value]: [string, string]): string => `${key}=${value}`)
      .join('\n'),
  );

  /**
   * Gets whether the selected configuration runs under the debugger.
   */
  protected readonly isDebug: Signal<boolean> = computed(
    (): boolean => this.selected()?.mode === 'debug',
  );

  /**
   * Gets whether the selected configuration is the workspace's default — the one Mission Control's Run
   * button single-presses.
   */
  protected readonly isDefault: Signal<boolean> = computed(
    (): boolean => this.selected()?.default === true,
  );

  /**
   * Gets whether the selected configuration presents its terminal in its own OS window.
   */
  protected readonly isWindowPresentation: Signal<boolean> = computed(
    (): boolean => this.selected()?.presentation === 'window',
  );

  /**
   * Seeds the draft from the persisted configurations whenever the dialog opens, so edits start from
   * the current state and Cancel simply discards the draft.
   */
  public constructor() {
    // Seeds the draft when the dialog opens, and re-seeds it whenever the persisted set changes while
    // it is open — which is how the agent's writes appear in the list as it authors them (it writes
    // straight to `.studio` through its own tools). The selection is kept when it still exists, so a
    // configuration the user is reading does not jump under them as new ones land.
    effect((): void => {
      if (!this.dialog.isOpen()) {
        this.autoConfigureOpen.set(false);
        return;
      }
      const configurations: RunConfiguration[] = this.studio
        .runConfigurations()
        .map((configuration: RunConfiguration): RunConfiguration => ({ ...configuration }));
      this.draft.set(configurations);
      const selected: string | null = untracked((): string | null => this.selectedId());
      const stillPresent: boolean = configurations.some(
        (configuration: RunConfiguration): boolean => configuration.id === selected,
      );
      if (!stillPresent) {
        this.selectedId.set(configurations[0]?.id ?? null);
      }
    });
  }

  /**
   * Opens the Auto-configure modal, where the agent will be asked to author configurations.
   */
  protected onAutoConfigure(): void {
    this.log.info('workspace.run', 'Auto-configure modal opened');
    this.autoConfigureOpen.set(true);
  }

  /**
   * Closes the Auto-configure modal.
   */
  protected onAutoConfigureClose(): void {
    this.autoConfigureOpen.set(false);
  }

  /**
   * Narrows a tree row's payload for the projected row template, which receives the row untyped.
   * @param row The tree row.
   * @returns Returns the row's Configure-dialog payload.
   */
  protected asRow(row: TreeRow): ConfigurationRow {
    return row.data as ConfigurationRow;
  }

  /**
   * Handles a click on a tree row: a group row toggles, a configuration row is selected for editing.
   * @param row The clicked row.
   */
  protected onRowClick(row: TreeRow): void {
    const data: ConfigurationRow = row.data as ConfigurationRow;
    if (!data.isGroup) {
      this.selectedId.set(data.configuration?.id ?? null);
      return;
    }
    const kind: string = row.id.slice(GROUP_PREFIX.length);
    this.collapsedKinds.update((kinds: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(kinds);
      if (!next.delete(kind)) {
        next.add(kind);
      }
      return next;
    });
  }

  /**
   * Adds a new configuration bound to the active provider kind and selects it.
   */
  protected onNew(): void {
    const configuration: RunConfiguration = {
      id: crypto.randomUUID(),
      name: 'New Configuration',
      providerKind: this.workspaceCapabilities.kind() ?? 'dotnet',
      mode: 'run',
    };
    this.log.debug(
      'workspace.run',
      'New run configuration added to draft',
      configuration.providerKind,
    );
    this.draft.update((list: readonly RunConfiguration[]): readonly RunConfiguration[] => [
      ...list,
      configuration,
    ]);
    this.selectedId.set(configuration.id);
  }

  /**
   * Duplicates the selected configuration and selects the copy.
   */
  protected onDuplicate(): void {
    const source: RunConfiguration | null = this.selected();
    if (source === null) {
      return;
    }
    const copy: RunConfiguration = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} copy`,
    };
    this.draft.update((list: readonly RunConfiguration[]): readonly RunConfiguration[] => [
      ...list,
      copy,
    ]);
    this.selectedId.set(copy.id);
  }

  /**
   * Deletes the selected configuration and selects the first remaining one.
   */
  protected onDelete(): void {
    const id: string | null = this.selectedId();
    if (id === null) {
      return;
    }
    this.log.debug('workspace.run', 'Run configuration deleted from draft', id);
    this.draft.update((list: readonly RunConfiguration[]): readonly RunConfiguration[] =>
      list.filter((configuration: RunConfiguration): boolean => configuration.id !== id),
    );
    this.selectedId.set(this.draft()[0]?.id ?? null);
  }

  /**
   * Updates the selected configuration's name.
   * @param name The new name.
   */
  protected onName(name: string): void {
    this.patch({ name });
  }

  /**
   * Updates the selected configuration's build configuration.
   * @param buildConfiguration The build-configuration id.
   */
  protected onBuildConfiguration(buildConfiguration: string): void {
    this.patch({
      buildConfiguration: buildConfiguration.length > 0 ? buildConfiguration : undefined,
    });
  }

  /**
   * Updates the selected configuration's target.
   * @param target The target-option id.
   */
  protected onTarget(target: string): void {
    this.patch({ target: target.length > 0 ? target : undefined });
  }

  /**
   * Updates the selected configuration's program.
   * @param program The program.
   */
  protected onProgram(program: string): void {
    this.patch({ program: program.length > 0 ? program : undefined });
  }

  /**
   * Updates the selected configuration's arguments from a space-separated string.
   * @param text The arguments text.
   */
  protected onArgs(text: string): void {
    const args: string[] = text
      .split(/\s+/)
      .filter((argument: string): boolean => argument.length > 0);
    this.patch({ args: args.length > 0 ? args : undefined });
  }

  /**
   * Updates the selected configuration's working directory.
   * @param cwd The working directory.
   */
  protected onCwd(cwd: string): void {
    this.patch({ cwd: cwd.length > 0 ? cwd : undefined });
  }

  /**
   * Updates the selected configuration's environment from `KEY=value` lines.
   * @param text The environment text.
   */
  protected onEnv(text: string): void {
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const separator: number = line.indexOf('=');
      if (separator <= 0) {
        continue;
      }
      const key: string = line.slice(0, separator).trim();
      if (key.length > 0) {
        env[key] = line.slice(separator + 1).trim();
      }
    }
    this.patch({ env: Object.keys(env).length > 0 ? env : undefined });
  }

  /**
   * Updates whether the selected configuration runs or debugs.
   * @param debug Whether the configuration debugs.
   */
  protected onModeChange(debug: boolean): void {
    this.patch({ mode: debug ? 'debug' : 'run' });
  }

  /**
   * Sets or clears the selected configuration as the workspace's default. A workspace has at most one
   * default, so turning this on clears the flag on every other configuration; the flag is dropped
   * rather than written false, keeping the persisted file minimal.
   * @param isDefault Whether the selected configuration should be the default.
   */
  protected onDefaultChange(isDefault: boolean): void {
    const id: string | null = this.selectedId();
    if (id === null) {
      return;
    }
    this.draft.update((list: readonly RunConfiguration[]): readonly RunConfiguration[] =>
      list.map((configuration: RunConfiguration): RunConfiguration => {
        if (configuration.id === id) {
          return { ...configuration, default: isDefault ? true : undefined };
        }
        // Only one default per workspace: setting this one the default clears any other's flag.
        return isDefault && configuration.default === true
          ? { ...configuration, default: undefined }
          : configuration;
      }),
    );
  }

  /**
   * Applies the presentation toggle: on presents the run's terminal in its own OS window; off
   * returns to the default (the field is dropped, so the persisted file stays minimal).
   * @param window Whether the run's terminal presents in its own window.
   */
  protected onPresentationChange(window: boolean): void {
    this.patch({ presentation: window ? 'window' : undefined });
  }

  /**
   * Persists the draft configurations and closes the dialog.
   */
  protected onSave(): void {
    this.log.info('workspace.run', 'Run configurations saved', this.draft().length);
    void this.studio.saveRunConfigurations(this.draft());
    this.dialog.close();
  }

  /**
   * Discards the draft and closes the dialog.
   */
  protected onCancel(): void {
    this.dialog.close();
  }

  /**
   * Applies a patch to the selected configuration in the draft.
   * @param patch The fields to change.
   */
  private patch(patch: Partial<RunConfiguration>): void {
    const id: string | null = this.selectedId();
    if (id === null) {
      return;
    }
    this.draft.update((list: readonly RunConfiguration[]): readonly RunConfiguration[] =>
      list.map((configuration: RunConfiguration): RunConfiguration =>
        configuration.id === id ? { ...configuration, ...patch } : configuration,
      ),
    );
  }
}
