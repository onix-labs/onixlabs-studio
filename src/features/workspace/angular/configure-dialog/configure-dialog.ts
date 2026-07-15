import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { ConfigureDialog } from '@shared/angular/services/configure-dialog/configure-dialog';
import { WorkspaceCapabilities } from '@shared/angular/services/workspace/workspace-capabilities';
import { RunConfiguration } from '@shared/api/studio';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '@shared/angular/components/modal/modal';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';

/**
 * A group of run configurations sharing a provider kind, shown as a labelled section in the dialog's
 * list.
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
 * The run-configuration Configure dialog: a master-detail editor over the active workspace's `.studio`
 * run configurations. The list (grouped by provider kind) offers create, duplicate, and delete; the
 * detail form edits the selected configuration's name, build configuration and target (shown only when
 * the provider declares them), program, arguments, working directory, environment variables, and
 * whether it runs or debugs. Edits are made against a draft copy taken when the dialog opens, so Cancel
 * discards them and Save writes the whole set back to `workspace.json` through {@link StudioConfig}.
 */
@Component({
  selector: 'app-configure-dialog',
  imports: [Modal, AppIcon, Dropdown, SettingRow, TextField, Toggle],
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
      this.workspaceCapabilities.capabilities()?.buildConfigurations.map(
        (configuration): DropdownOption => ({ value: configuration.id, label: configuration.name }),
      ) ?? [],
  );

  /**
   * Gets the target options offered by the detail form, or an empty list when the provider has none.
   */
  protected readonly targetOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.workspaceCapabilities.capabilities()?.target?.options.map(
        (option): DropdownOption => ({ value: option.id, label: option.name }),
      ) ?? [],
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
   * Seeds the draft from the persisted configurations whenever the dialog opens, so edits start from
   * the current state and Cancel simply discards the draft.
   */
  public constructor() {
    effect((): void => {
      if (this.dialog.isOpen()) {
        const configurations: RunConfiguration[] = this.studio
          .runConfigurations()
          .map((configuration: RunConfiguration): RunConfiguration => ({ ...configuration }));
        this.draft.set(configurations);
        this.selectedId.set(configurations[0]?.id ?? null);
      }
    });
  }

  /**
   * Selects a configuration for editing.
   * @param id The configuration id.
   */
  protected select(id: string): void {
    this.selectedId.set(id);
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
    const copy: RunConfiguration = { ...source, id: crypto.randomUUID(), name: `${source.name} copy` };
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
    this.patch({ buildConfiguration: buildConfiguration.length > 0 ? buildConfiguration : undefined });
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
    const args: string[] = text.split(/\s+/).filter((argument: string): boolean => argument.length > 0);
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
   * Persists the draft configurations and closes the dialog.
   */
  protected onSave(): void {
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
      list.map(
        (configuration: RunConfiguration): RunConfiguration =>
          configuration.id === id ? { ...configuration, ...patch } : configuration,
      ),
    );
  }
}
