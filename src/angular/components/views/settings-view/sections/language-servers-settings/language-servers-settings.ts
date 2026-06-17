import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { LspSettings as LspSettingsData } from '../../../../../../shared/lsp-types';
import { LspSettings } from '../../../../../services/lsp/lsp-settings';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { TextField } from '../../../../forms/text-field/text-field';
import { Toggle } from '../../../../forms/toggle/toggle';

/**
 * Describes a language server shown in the settings section.
 */
interface ServerOption {
  /**
   * Gets the server identifier.
   */
  readonly id: string;

  /**
   * Gets the display label.
   */
  readonly label: string;

  /**
   * Gets the description shown beneath the label.
   */
  readonly description: string;
}

/**
 * Represents the Language Servers section of the settings view. It lets the user turn individual
 * servers off (for example to avoid downloading the Java server) and override the Java runtime when it
 * cannot be detected. The settings are owned by the main process; a change applies to servers started
 * afterwards.
 */
@Component({
  selector: 'app-language-servers-settings',
  imports: [SettingRow, Toggle, TextField],
  templateUrl: './language-servers-settings.html',
  styleUrls: ['../section.scss', './language-servers-settings.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageServersSettings {
  /**
   * Holds the renderer language-server settings service.
   */
  private readonly lspSettings: LspSettings = inject(LspSettings);

  /**
   * Gets the active settings.
   */
  protected readonly settings: Signal<LspSettingsData> = this.lspSettings.settings;

  /**
   * Gets whether the settings bridge is available (running inside Studio).
   */
  protected readonly isAvailable: boolean = this.lspSettings.isAvailable;

  /**
   * Gets the servers the user can enable or disable.
   */
  protected readonly servers: readonly ServerOption[] = [
    {
      id: 'typescript',
      label: 'TypeScript / JavaScript',
      description:
        'Diagnostics, completion, hover, and go-to-definition for TypeScript and JavaScript.',
    },
    {
      id: 'java',
      label: 'Java',
      description:
        'Eclipse JDT Language Server. Requires a Java 21+ runtime; downloaded on first use.',
    },
    {
      id: 'python',
      label: 'Python',
      description: 'Pyright. Diagnostics, completion, hover, and go-to-definition for Python.',
    },
    {
      id: 'csharp',
      label: 'C#',
      description:
        'Roslyn language server. Requires the .NET 10+ SDK; downloaded on first use. Build the project for full results.',
    },
    {
      id: 'clangd',
      label: 'C / C++',
      description:
        'clangd. Requires LLVM or Xcode Command Line Tools. A compile_commands.json gives full results.',
    },
  ];

  /**
   * Initialises the section, refreshing the settings from the main process.
   */
  public constructor() {
    void this.lspSettings.refresh();
  }

  /**
   * Gets whether a server is enabled.
   * @param serverId The server identifier.
   * @returns Returns true when the server is enabled.
   */
  protected isEnabled(serverId: string): boolean {
    return !this.settings().disabledServers.includes(serverId);
  }

  /**
   * Enables or disables a server.
   * @param serverId The server identifier.
   * @param enabled Whether the server should be enabled.
   */
  protected onToggle(serverId: string, enabled: boolean): void {
    void this.lspSettings.setServerEnabled(serverId, enabled);
  }

  /**
   * Sets the Java runtime override.
   * @param javaPath The Java executable path, or an empty string to auto-detect.
   */
  protected onJavaPathChange(javaPath: string): void {
    void this.lspSettings.setJavaPath(javaPath);
  }

  /**
   * Sets the .NET runtime override.
   * @param dotnetPath The .NET executable path, or an empty string to auto-detect.
   */
  protected onDotnetPathChange(dotnetPath: string): void {
    void this.lspSettings.setDotnetPath(dotnetPath);
  }

  /**
   * Sets the clangd override.
   * @param clangdPath The clangd executable path, or an empty string to auto-detect.
   */
  protected onClangdPathChange(clangdPath: string): void {
    void this.lspSettings.setClangdPath(clangdPath);
  }

  /**
   * Sets the custom TypeScript server path.
   * @param serverPath The TypeScript server entry point, or an empty string to use the bundled one.
   */
  protected onTypescriptServerPathChange(serverPath: string): void {
    void this.lspSettings.setTypescriptServerPath(serverPath);
  }

  /**
   * Gets a server's extra arguments as a space-separated string.
   * @param serverId The server identifier.
   * @returns Returns the arguments joined by spaces.
   */
  protected serverArgs(serverId: string): string {
    return this.lspSettings.serverArgsText(serverId);
  }

  /**
   * Sets a server's extra command-line arguments.
   * @param serverId The server identifier.
   * @param argsText The arguments as a whitespace-separated string.
   */
  protected onServerArgsChange(serverId: string, argsText: string): void {
    void this.lspSettings.setServerArgs(serverId, argsText);
  }
}
