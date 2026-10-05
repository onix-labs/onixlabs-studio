import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
  WritableSignal,
} from '@angular/core';
import { SourceControlClient, VersionControlPluginInfo } from '@shared/api/source-control-channels';
import {
  VersionControlExecutableChoice,
  VersionControlExecutableMode,
} from '@shared/api/version-control-protocol';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { SourceControl } from '@shared/angular/services/source-control/source-control';

/**
 * The label each executable mode is offered under.
 */
const MODE_LABELS: Readonly<Record<VersionControlExecutableMode, string>> = {
  installed: 'Installed (on your PATH)',
  bundled: 'Bundled with the plugin',
  custom: 'Custom path',
};

/**
 * One plugin's row while it is being edited: what it is, and the draft choice.
 */
interface PluginRow {
  /**
   * Gets the plugin as the main process last described it.
   */
  readonly info: VersionControlPluginInfo;

  /**
   * Gets the drafted mode.
   */
  readonly mode: VersionControlExecutableMode;

  /**
   * Gets the drafted custom path.
   */
  readonly path: string;
}

/**
 * Lists the installed version-control plugins in Settings ▸ Source Control, with which tool each runs
 * (#817) — offering exactly the modes the plugin's manifest advertises, the way the Claude provider
 * offers its CLI. Saving restarts the plugin, and the row then shows the version that tool reports, or
 * why it could not be run.
 */
@Component({
  selector: 'app-version-control-plugins',
  imports: [Button, Dropdown, SettingRow, TextField],
  templateUrl: './version-control-plugins.html',
  styleUrl: './version-control-plugins.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VersionControlPlugins implements OnInit {
  /**
   * Holds the source-control client, or undefined outside Electron.
   */
  private readonly client: SourceControlClient | undefined = inject(SourceControl).client;

  /**
   * Holds one row per installed plugin.
   */
  protected readonly rows: WritableSignal<readonly PluginRow[]> = signal<readonly PluginRow[]>([]);

  /**
   * Holds whether the list has been read.
   */
  protected readonly loaded: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the id of the plugin being saved, or null.
   */
  protected readonly saving: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Reads the installed plugins.
   */
  public ngOnInit(): void {
    void this.load();
  }

  /**
   * Gets the options a plugin's dropdown offers.
   * @param row The row.
   * @returns Returns the options.
   */
  protected options(row: PluginRow): readonly DropdownOption[] {
    return row.info.executableModes.map((mode: VersionControlExecutableMode): DropdownOption => ({
      value: mode,
      label: MODE_LABELS[mode],
    }));
  }

  /**
   * Gets what a plugin's row says beneath its name: the tool it runs, or what is wrong.
   * @param row The row.
   * @returns Returns the description.
   */
  protected describe(row: PluginRow): string {
    return row.info.toolVersion ?? row.info.problem ?? 'Not running.';
  }

  /**
   * Records a drafted mode.
   * @param row The row.
   * @param mode The mode chosen.
   */
  protected onMode(row: PluginRow, mode: string): void {
    this.update(row, { mode: mode as VersionControlExecutableMode });
  }

  /**
   * Records a drafted path.
   * @param row The row.
   * @param path The path typed.
   */
  protected onPath(row: PluginRow, path: string): void {
    this.update(row, { path });
  }

  /**
   * Gets whether a row's draft can be saved: it differs from what is in force, and a custom path is
   * absolute.
   * @param row The row.
   * @returns Returns true when Save is enabled.
   */
  protected canSave(row: PluginRow): boolean {
    if (this.saving() !== null) {
      return false;
    }
    if (row.mode === 'custom' && !/^(\/|[A-Za-z]:[\\/])/.test(row.path.trim())) {
      return false;
    }
    const current: VersionControlExecutableChoice | null = row.info.executable;
    return (
      row.mode !== (current?.mode ?? 'installed') ||
      (row.mode === 'custom' && row.path.trim() !== (current?.path ?? ''))
    );
  }

  /**
   * Saves a row's draft, restarting its plugin.
   * @param row The row.
   */
  protected async onSave(row: PluginRow): Promise<void> {
    if (this.client === undefined || !this.canSave(row)) {
      return;
    }
    this.saving.set(row.info.id);
    try {
      const saved: VersionControlPluginInfo | null = await this.client.setExecutable(
        row.info.id,
        row.mode === 'installed' ? null : { mode: row.mode, path: row.path.trim() },
      );
      if (saved !== null) {
        this.rows.update((rows: readonly PluginRow[]): readonly PluginRow[] =>
          rows.map((candidate: PluginRow): PluginRow =>
            candidate.info.id === saved.id ? toRow(saved) : candidate,
          ),
        );
      }
    } finally {
      this.saving.set(null);
    }
  }

  /**
   * Reads the installed plugins from the main process.
   */
  private async load(): Promise<void> {
    const plugins: readonly VersionControlPluginInfo[] = (await this.client?.listPlugins()) ?? [];
    this.rows.set(
      plugins.filter((plugin: VersionControlPluginInfo): boolean => plugin.installed).map(toRow),
    );
    this.loaded.set(true);
  }

  /**
   * Replaces a row's draft fields.
   * @param row The row.
   * @param change The fields to replace.
   */
  private update(row: PluginRow, change: Partial<Pick<PluginRow, 'mode' | 'path'>>): void {
    this.rows.update((rows: readonly PluginRow[]): readonly PluginRow[] =>
      rows.map((candidate: PluginRow): PluginRow =>
        candidate.info.id === row.info.id ? { ...candidate, ...change } : candidate,
      ),
    );
  }
}

/**
 * Builds an editable row from a plugin's information.
 * @param info The plugin.
 * @returns Returns the row, its draft matching what is in force.
 */
function toRow(info: VersionControlPluginInfo): PluginRow {
  return {
    info,
    mode: info.executable?.mode ?? 'installed',
    path: info.executable?.path ?? '',
  };
}
