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
import { Bridge } from '@shared/api/bridge';
import {
  PackageChannel,
  PackageRegistryToken,
  PackageTokenResult,
} from '@shared/api/package-channels';
import { installedContributions, PluginContribution } from '@shared/api/plugin-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PasswordField } from '@shared/angular/components/forms/password-field/password-field';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Log } from '@shared/angular/services/log/log';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * Lists the registry tokens saved in Studio for the installed package-manager plugins, in Settings ›
 * Workspaces › Package Managers (#911), and saves new ones.
 *
 * A plugin reads its tool's own configuration first — `.npmrc`, `nuget.config` — exactly as the tool
 * would. A token saved here is the second route, for a private registry whose credential is not in
 * that configuration: the plugin asks for it mid-request, for that registry only, and is handed it
 * only if it was saved for that plugin. A token is written straight to the main process and never
 * read back; this page sees which registries have one, not what it is.
 */
@Component({
  selector: 'app-package-registry-tokens',
  imports: [Button, ButtonRow, Dropdown, PasswordField, SettingRow, TextField],
  templateUrl: './package-registry-tokens.html',
  styleUrl: './package-registry-tokens.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PackageRegistryTokens {
  /**
   * Holds the plugin client, for the installed package managers and their names.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the generic transport, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Gets the installed package-manager contributions.
   */
  protected readonly managers: Signal<readonly PluginContribution[]> = computed(
    (): readonly PluginContribution[] =>
      installedContributions(this.plugins.plugins(), 'package-manager'),
  );

  /**
   * Gets the package managers a token can be saved for, as picker options.
   */
  protected readonly managerOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.managers().map((contribution: PluginContribution): DropdownOption => ({
        value: contribution.id,
        label: contribution.displayName,
      })),
  );

  /**
   * Holds the registries a token is saved for.
   */
  protected readonly tokens: WritableSignal<readonly PackageRegistryToken[]> = signal<
    readonly PackageRegistryToken[]
  >([]);

  /**
   * Holds the package manager a new token is for, or null for the first installed one.
   */
  protected readonly draftPlugin: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the registry being typed.
   */
  protected readonly draftRegistry: WritableSignal<string> = signal<string>('');

  /**
   * Holds the token being typed, which is never persisted here.
   */
  protected readonly draftToken: WritableSignal<string> = signal<string>('');

  /**
   * Holds why the last save was refused, or null.
   */
  protected readonly error: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether a change is in flight.
   */
  protected readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the package manager a new token is for.
   */
  protected readonly selectedPlugin: Signal<string | null> = computed(
    (): string | null => this.draftPlugin() ?? this.managers()[0]?.id ?? null,
  );

  /**
   * Gets whether the draft can be saved.
   */
  protected readonly canSave: Signal<boolean> = computed(
    (): boolean =>
      !this.busy() &&
      this.selectedPlugin() !== null &&
      this.draftRegistry().trim().length > 0 &&
      this.draftToken().trim().length > 0,
  );

  /**
   * Reads the saved registries when the page opens, and again when a package manager is installed or
   * removed while it is open.
   */
  public constructor() {
    effect((): void => {
      this.managers();
      untracked((): void => void this.refresh());
    });
  }

  /**
   * Gets the display name of the package manager a token is saved for.
   * @param token The saved token.
   * @returns Returns the name, or the plugin id for one no longer installed.
   */
  protected managerName(token: PackageRegistryToken): string {
    return (
      this.managers().find(
        (contribution: PluginContribution): boolean => contribution.id === token.pluginId,
      )?.displayName ?? token.pluginId
    );
  }

  /**
   * Saves the draft token.
   * @returns Returns a promise that resolves once the main process has answered.
   */
  protected async save(): Promise<void> {
    const pluginId: string | null = this.selectedPlugin();
    if (this.bridge === undefined || pluginId === null || !this.canSave()) {
      return;
    }
    this.busy.set(true);
    try {
      const result: PackageTokenResult = await this.bridge.invoke<PackageTokenResult>(
        PackageChannel.SaveToken,
        pluginId,
        this.draftRegistry(),
        this.draftToken(),
      );
      if (result.ok) {
        this.tokens.set(result.tokens);
        this.draftRegistry.set('');
        this.draftToken.set('');
        this.error.set(null);
        this.log.info('settings.packages', 'Saved a registry token', pluginId);
      } else {
        this.error.set(result.error);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Forgets a saved token.
   * @param token The saved token.
   * @returns Returns a promise that resolves once the main process has answered.
   */
  protected async remove(token: PackageRegistryToken): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    this.busy.set(true);
    try {
      const result: PackageTokenResult = await this.bridge.invoke<PackageTokenResult>(
        PackageChannel.ClearToken,
        token.pluginId,
        token.registry,
      );
      if (result.ok) {
        this.tokens.set(result.tokens);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Reads the saved registries.
   * @returns Returns a promise that resolves once they have been read.
   */
  private async refresh(): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    this.tokens.set(
      await this.bridge.invoke<readonly PackageRegistryToken[]>(PackageChannel.Tokens),
    );
  }
}
