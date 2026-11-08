import { effect, inject, Service, untracked } from '@angular/core';
import type { LspServerSettingValue, LspServerSummary } from '@shared/api/lsp-channels';
import { Log } from '@shared/angular/services/log/log';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { Settings, TextEditorSettings } from '@shared/angular/services/settings/settings';
import {
  CODE_LENS_SERVER_SWITCHES,
  CodeLensKind,
  CodeLensServerSwitch,
  CodeLensServerSwitchChange,
  CodeLensSwitches,
  codeLensServerSwitchChanges,
} from './code-lens-kinds';

/**
 * The storage key that records the servers' own lens switches were carried over into the code-lens
 * switches (#1215), once.
 */
export const CODE_LENS_ADOPTED_KEY: string = 'studio.codeLens.serverSwitchesAdopted';

/**
 * The code-lens setting each kind is switched by.
 */
const FIELD_OF_KIND: Readonly<Record<CodeLensKind, keyof TextEditorSettings>> = {
  references: 'codeLensReferences',
  implementations: 'codeLensImplementations',
  tests: 'codeLensTests',
  other: 'codeLensOther',
};

/**
 * Keeps the servers' own lens switches in step with the code-lens switches (#1215): C#'s reference
 * counts, TypeScript's and Java's, gopls's test lens. Each is answered from whether its language shows
 * its kind, so a server neither computes lenses nobody sees nor hides ones the user asked for.
 *
 * The first time it runs, a server switch the user had already changed from its default becomes that
 * language's override of the kind — C#'s Reference Counts turned off stays off for C# — so moving the
 * switches into one place loses nobody's choice.
 */
@Service()
export class CodeLensServerSync {
  /**
   * Holds the code settings the switches are read from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the language-server settings the server switches are stored in.
   */
  private readonly lspSettings: LspSettings = inject(LspSettings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Initializes the service, keeping the switches in step from the moment both sets of settings are
   * read.
   */
  public constructor() {
    effect((): void => {
      if (!this.lspSettings.settingsLoaded() || !this.lspSettings.catalogueLoaded()) {
        return;
      }
      const installed: ReadonlySet<string> = new Set<string>(
        this.lspSettings.catalogue().map((server: LspServerSummary): string => server.id),
      );
      // Read for their changes: the switches, every language's overrides, and the stored values.
      this.settings.globalTextEditor();
      this.settings.languageOverrides();
      this.lspSettings.settings();
      untracked((): void => this.sync(installed));
    });
  }

  /**
   * Stores whatever server switches differ from what the code-lens switches say, carrying the user's
   * own choices over first, once.
   * @param installed The servers installed.
   */
  private sync(installed: ReadonlySet<string>): void {
    if (!adopted()) {
      this.adopt(installed);
      remember();
    }
    const changes: CodeLensServerSwitchChange[] = codeLensServerSwitchChanges(
      (language: string): CodeLensSwitches => this.settings.resolveSettingsForLanguage(language),
      (serverId: string, section: string): LspServerSettingValue | undefined =>
        this.lspSettings.serverSetting(serverId, section),
      installed,
    );
    if (changes.length > 0) {
      this.log.debug('CodeLens', `Keeping ${changes.length} server lens switch(es) in step`);
      void this.lspSettings.setServerSettings(changes);
    }
  }

  /**
   * Makes each server switch the user changed from its default into its language's override of the
   * kind, unless the language already overrides it.
   * @param installed The servers installed.
   */
  private adopt(installed: ReadonlySet<string>): void {
    for (const entry of CODE_LENS_SERVER_SWITCHES) {
      const stored: LspServerSettingValue | undefined = installed.has(entry.serverId)
        ? this.lspSettings.serverSetting(entry.serverId, entry.section)
        : undefined;
      if (typeof stored !== 'boolean' || stored === entry.serverDefault) {
        continue;
      }
      const field: keyof TextEditorSettings = FIELD_OF_KIND[entry.kind];
      if (overrides(this.settings, entry, field)) {
        continue;
      }
      if (this.settings.resolveSettingsForLanguage(entry.language)[field] !== stored) {
        this.log.info('CodeLens', `Carrying ${entry.section} over as a ${entry.language} override`);
        this.settings.setLanguageOverride(entry.language, field, stored);
      }
    }
  }
}

/**
 * Determines whether a language already overrides a kind's switch.
 * @param settings The code settings.
 * @param entry The server switch.
 * @param field The kind's setting.
 * @returns Returns true when it does.
 */
function overrides(
  settings: Settings,
  entry: CodeLensServerSwitch,
  field: keyof TextEditorSettings,
): boolean {
  return settings.languageOverrides()[entry.language]?.[field] !== undefined;
}

/**
 * Determines whether the server switches have been carried over already.
 * @returns Returns true when they have, or when storage cannot say (so nothing is carried twice).
 */
function adopted(): boolean {
  try {
    return localStorage.getItem(CODE_LENS_ADOPTED_KEY) === 'true';
  } catch {
    return true;
  }
}

/**
 * Remembers that the server switches have been carried over, quietly when storage is unavailable.
 */
function remember(): void {
  try {
    localStorage.setItem(CODE_LENS_ADOPTED_KEY, 'true');
  } catch {
    // Not remembered: the next session looks again, and finds the choices already carried.
  }
}
