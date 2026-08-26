import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { LspServerSummary } from '@shared/api/lsp-channels';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';

/**
 * Names the tool-path override a language's server needs, where one applies. These are the runtimes a
 * server runs *on* rather than the server itself, so they are language-scoped only by association —
 * the Java runtime override is the same value on the Java and Kotlin pages, shown where each is looked
 * for.
 */
type PathOverride = 'typescriptServer' | 'java' | 'dotnet' | 'clangd';

/**
 * Maps a language to the tool-path override shown on its page, if any.
 */
const PATH_OVERRIDES: Readonly<Record<string, PathOverride>> = {
  typescript: 'typescriptServer',
  javascript: 'typescriptServer',
  java: 'java',
  kotlin: 'java',
  csharp: 'dotnet',
  cpp: 'clangd',
  c: 'clangd',
};

/**
 * Describes a tool-path override's presentation.
 */
const PATH_LABELS: Readonly<Record<PathOverride, { label: string; description: string }>> = {
  typescriptServer: {
    label: 'Custom server path',
    description:
      'Path to a custom typescript-language-server CLI module (its JavaScript entry point). Leave empty to use the copy installed under Plugins.',
  },
  java: {
    label: 'Java runtime path',
    description:
      'The Java 21+ executable this language server runs on. Leave empty to detect it automatically.',
  },
  dotnet: {
    label: '.NET SDK path',
    description:
      'The .NET 10+ executable the language server runs on. Leave empty to detect it automatically.',
  },
  clangd: {
    label: 'Custom clangd path',
    description: 'Your own clangd executable. Leave empty to use the copy installed under Plugins.',
  },
};

/**
 * The settings for one language's tooling: which installed server serves it, whether it runs, the
 * arguments it starts with, and the tool path it needs.
 *
 * A page per language, rather than one list of every server, because that is how the question is
 * actually asked — "what happens when I open a Rust file" — and because the set of servers is no longer
 * fixed. The choice of *which* server appears only when the user has installed more than one for the
 * language: one implementation is not a choice.
 */
@Component({
  selector: 'app-language-server-settings',
  imports: [Dropdown, SettingRow, TextField, Toggle],
  templateUrl: './language-server-settings.html',
  styleUrl: './language-server-settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageServerSettings {
  /**
   * Gets the Monaco language identifier this page configures.
   */
  public readonly language: InputSignal<string> = input.required<string>();

  /**
   * Gets the display name of the language.
   */
  public readonly languageName: InputSignal<string> = input.required<string>();

  /**
   * Holds the language-server settings this page reads and writes.
   */
  private readonly lspSettings: LspSettings = inject(LspSettings);

  /**
   * Gets the installed servers that serve this language.
   */
  protected readonly servers: Signal<readonly LspServerSummary[]> = computed(
    (): readonly LspServerSummary[] => this.lspSettings.serversForLanguage(this.language()),
  );

  /**
   * Gets whether the user has a choice of server to make — true only when more than one installed
   * plugin serves the language.
   */
  protected readonly hasChoice: Signal<boolean> = computed(
    (): boolean => this.servers().length > 1,
  );

  /**
   * Gets the servers as dropdown options.
   */
  protected readonly options: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.servers().map(
        (server: LspServerSummary): DropdownOption => ({
          value: server.id,
          label: server.displayName,
        }),
      ),
  );

  /**
   * Gets the server currently serving this language, or an empty string when none is installed.
   */
  protected readonly activeServer: Signal<string> = computed(
    (): string => this.lspSettings.serverForLanguage(this.language()) ?? '',
  );

  /**
   * Gets the display name of the server currently serving this language.
   */
  protected readonly activeServerName: Signal<string> = computed((): string => {
    const active: string = this.activeServer();
    return (
      this.servers().find((server: LspServerSummary): boolean => server.id === active)
        ?.displayName ?? active
    );
  });

  /**
   * Gets whether the active server is enabled.
   */
  protected readonly enabled: Signal<boolean> = computed(
    (): boolean => !this.lspSettings.isDisabled(this.activeServer()),
  );

  /**
   * Gets the active server's extra arguments, as the user typed them.
   */
  protected readonly args: Signal<string> = computed((): string =>
    this.lspSettings.serverArgsText(this.activeServer()),
  );

  /**
   * Gets the tool-path override that applies to this language, or null when none does.
   */
  protected readonly pathOverride: Signal<PathOverride | null> = computed(
    (): PathOverride | null => PATH_OVERRIDES[this.language()] ?? null,
  );

  /**
   * Gets the label for this language's tool-path override.
   */
  protected readonly pathLabel: Signal<string> = computed((): string => {
    const override: PathOverride | null = this.pathOverride();
    return override === null ? '' : PATH_LABELS[override].label;
  });

  /**
   * Gets the description for this language's tool-path override.
   */
  protected readonly pathDescription: Signal<string> = computed((): string => {
    const override: PathOverride | null = this.pathOverride();
    return override === null ? '' : PATH_LABELS[override].description;
  });

  /**
   * Gets the current value of this language's tool-path override.
   */
  protected readonly pathValue: Signal<string> = computed((): string => {
    const settings: ReturnType<LspSettings['settings']> = this.lspSettings.settings();
    switch (this.pathOverride()) {
      case 'typescriptServer':
        return settings.typescriptServerPath ?? '';
      case 'java':
        return settings.javaPath ?? '';
      case 'dotnet':
        return settings.dotnetPath ?? '';
      case 'clangd':
        return settings.clangdPath ?? '';
      default:
        return '';
    }
  });

  /**
   * Chooses which installed server serves this language.
   * @param serverId The chosen server.
   */
  protected choose(serverId: string): void {
    void this.lspSettings.setServerForLanguage(this.language(), serverId);
  }

  /**
   * Enables or disables the active server.
   * @param value Whether the server should run.
   */
  protected setEnabled(value: boolean): void {
    void this.lspSettings.setServerEnabled(this.activeServer(), value);
  }

  /**
   * Sets the active server's extra arguments.
   * @param value The arguments as typed, separated by spaces.
   */
  protected setArgs(value: string): void {
    void this.lspSettings.setServerArgs(this.activeServer(), value);
  }

  /**
   * Sets this language's tool-path override.
   * @param value The path, or an empty string to detect it automatically.
   */
  protected setPath(value: string): void {
    switch (this.pathOverride()) {
      case 'typescriptServer':
        void this.lspSettings.setTypescriptServerPath(value);
        break;
      case 'java':
        void this.lspSettings.setJavaPath(value);
        break;
      case 'dotnet':
        void this.lspSettings.setDotnetPath(value);
        break;
      case 'clangd':
        void this.lspSettings.setClangdPath(value);
        break;
      default:
        break;
    }
  }
}
