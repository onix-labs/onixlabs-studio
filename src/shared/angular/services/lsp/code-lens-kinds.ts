import type { LspServerSettingValue } from '@shared/api/lsp-channels';
import type { TextEditorSettings } from '@shared/angular/services/settings/settings';

/**
 * The kinds of code lens a user can switch on and off (#1215), the same for every language: a count of
 * references, a count of implementations, Run and Debug for a test, and everything else.
 */
export type CodeLensKind = 'references' | 'implementations' | 'tests' | 'other';

/**
 * The code-lens switches as one language resolves them: its overrides laid over the global settings.
 */
export type CodeLensSwitches = Pick<
  TextEditorSettings,
  'codeLens' | 'codeLensReferences' | 'codeLensImplementations' | 'codeLensTests' | 'codeLensOther'
>;

/**
 * The commands that say which kind a lens is, whichever server sent it. A command not listed here
 * falls back to the lens's title.
 */
const KIND_OF_COMMAND: Readonly<Record<string, CodeLensKind>> = {
  // Roslyn (#1149, #1150).
  'roslyn.client.peekReferences': 'references',
  'dotnet.test.run': 'tests',
  // jdtls.
  'java.show.references': 'references',
  'java.show.implementations': 'implementations',
  // gopls: its test lens; its others (generate, tidy, upgrade, vendor, vulncheck) are Other.
  'gopls.run_tests': 'tests',
  'gopls.test': 'tests',
};

/**
 * Says which kind a lens is (#1215): from its command where that says, from its title where the
 * command is shared — typescript-language-server's and rust-analyzer's references and implementations
 * lenses send one command, and rust-analyzer's Run lens runs a test or a program alike — and from its
 * title alone where the server gives no command at all, as lua-language-server's and Svelte's
 * reference counts do.
 * @param command The lens's command, or an empty string for none.
 * @param title The lens's title.
 * @returns Returns the kind.
 */
export function codeLensKind(command: string, title: string): CodeLensKind {
  const known: CodeLensKind | undefined = KIND_OF_COMMAND[command];
  if (known !== undefined) {
    return known;
  }
  if (/\bimplementations?\b/i.test(title)) {
    return 'implementations';
  }
  if (/\breferences?\b/i.test(title)) {
    return 'references';
  }
  if (/\btests?\b|\bbenchmarks?\b|\bdoctests?\b/i.test(title)) {
    return 'tests';
  }
  if (command === 'rust-analyzer.debugSingle') {
    // rust-analyzer's Debug, beside a Run Test.
    return 'tests';
  }
  return 'other';
}

/**
 * Determines whether a language's switches show a kind of lens: the master switch is on, and so is the
 * kind's own.
 * @param switches The language's switches.
 * @param kind The kind.
 * @returns Returns true when lenses of the kind are shown.
 */
export function showsCodeLensKind(switches: CodeLensSwitches, kind: CodeLensKind): boolean {
  if (!switches.codeLens) {
    return false;
  }
  switch (kind) {
    case 'references':
      return switches.codeLensReferences;
    case 'implementations':
      return switches.codeLensImplementations;
    case 'tests':
      return switches.codeLensTests;
    case 'other':
      return switches.codeLensOther;
  }
}

/**
 * A server's own switch for a kind of lens (#1215), which Studio answers from its code-lens switches
 * for the language, so the server does not compute lenses nobody will see — and shows the ones the
 * user asked for, where it would not by default.
 */
export interface CodeLensServerSwitch {
  /**
   * Gets the server.
   */
  readonly serverId: string;

  /**
   * Gets the setting's configuration section, as the server declares it.
   */
  readonly section: string;

  /**
   * Gets the language whose switches decide it.
   */
  readonly language: string;

  /**
   * Gets the kind of lens it switches.
   */
  readonly kind: CodeLensKind;

  /**
   * Gets the server's own default, which the setting is cleared back to rather than stored.
   */
  readonly serverDefault: boolean;
}

/**
 * The server switches answered from the code-lens switches. Each one's row leaves its language's
 * server page: the switch is on Code › Code Lenses now, and in each language's overrides.
 * rust-analyzer's master and Run switches stay on its own page: its Run lens runs a test or a program
 * alike, so no one kind decides it, and Studio's own filter hides what the switches leave out.
 */
export const CODE_LENS_SERVER_SWITCHES: readonly CodeLensServerSwitch[] = [
  {
    serverId: 'csharp',
    section: 'csharp|code_lens.dotnet_enable_references_code_lens',
    language: 'csharp',
    kind: 'references',
    serverDefault: true,
  },
  {
    serverId: 'csharp',
    section: 'csharp|code_lens.dotnet_enable_tests_code_lens',
    language: 'csharp',
    kind: 'tests',
    serverDefault: true,
  },
  {
    serverId: 'typescript',
    section: 'typescript.referencesCodeLens.enabled',
    language: 'typescript',
    kind: 'references',
    serverDefault: false,
  },
  {
    serverId: 'typescript',
    section: 'typescript.implementationsCodeLens.enabled',
    language: 'typescript',
    kind: 'implementations',
    serverDefault: false,
  },
  {
    serverId: 'typescript',
    section: 'javascript.referencesCodeLens.enabled',
    language: 'javascript',
    kind: 'references',
    serverDefault: false,
  },
  {
    serverId: 'java',
    section: 'java.referencesCodeLens.enabled',
    language: 'java',
    kind: 'references',
    serverDefault: true,
  },
  {
    serverId: 'java',
    section: 'java.implementationsCodeLens.enabled',
    language: 'java',
    kind: 'implementations',
    serverDefault: false,
  },
  {
    // lua-language-server's one switch for its lenses, which are reference counts (#1214).
    serverId: 'lua-language-server',
    section: 'Lua.codeLens.enable',
    language: 'lua',
    kind: 'references',
    serverDefault: false,
  },
  {
    serverId: 'go',
    section: 'gopls.codelenses.test',
    language: 'go',
    kind: 'tests',
    serverDefault: false,
  },
  {
    serverId: 'rust',
    section: 'rust-analyzer.lens.implementations.enable',
    language: 'rust',
    kind: 'implementations',
    serverDefault: true,
  },
  {
    serverId: 'rust',
    section: 'rust-analyzer.lens.references.adt.enable',
    language: 'rust',
    kind: 'references',
    serverDefault: false,
  },
  {
    serverId: 'rust',
    section: 'rust-analyzer.lens.references.method.enable',
    language: 'rust',
    kind: 'references',
    serverDefault: false,
  },
  {
    serverId: 'rust',
    section: 'rust-analyzer.lens.references.trait.enable',
    language: 'rust',
    kind: 'references',
    serverDefault: false,
  },
  {
    serverId: 'rust',
    section: 'rust-analyzer.lens.references.enumVariant.enable',
    language: 'rust',
    kind: 'references',
    serverDefault: false,
  },
];

/**
 * A change to one server switch's stored value.
 */
export interface CodeLensServerSwitchChange {
  /**
   * Gets the server.
   */
  readonly serverId: string;

  /**
   * Gets the setting's configuration section.
   */
  readonly section: string;

  /**
   * Gets the value to store, or null to clear it back to the server's default.
   */
  readonly value: LspServerSettingValue | null;
}

/**
 * Works out what the server switches must be stored as for the code-lens switches (#1215): each
 * switch's value is whether its language shows its kind, stored only where it differs from the
 * server's default. Only the changes are returned, so applying them twice changes nothing.
 * @param switchesFor Resolves a language's code-lens switches.
 * @param stored Reads a server switch's stored value.
 * @param installed The servers installed, whose switches are kept in step.
 * @returns Returns the changes to store.
 */
export function codeLensServerSwitchChanges(
  switchesFor: (language: string) => CodeLensSwitches,
  stored: (serverId: string, section: string) => LspServerSettingValue | undefined,
  installed: ReadonlySet<string>,
): CodeLensServerSwitchChange[] {
  const changes: CodeLensServerSwitchChange[] = [];
  for (const entry of CODE_LENS_SERVER_SWITCHES) {
    if (!installed.has(entry.serverId)) {
      continue;
    }
    const shown: boolean = showsCodeLensKind(switchesFor(entry.language), entry.kind);
    const value: LspServerSettingValue | null = shown === entry.serverDefault ? null : shown;
    if ((stored(entry.serverId, entry.section) ?? null) !== value) {
      changes.push({ serverId: entry.serverId, section: entry.section, value });
    }
  }
  return changes;
}

/**
 * Determines whether a server setting is one of the switches answered from the code-lens switches, so
 * it is not offered on the server's own page.
 * @param serverId The server.
 * @param section The setting's section.
 * @returns Returns true when it is.
 */
export function isCodeLensServerSwitch(serverId: string, section: string): boolean {
  return CODE_LENS_SERVER_SWITCHES.some(
    (entry: CodeLensServerSwitch): boolean =>
      entry.serverId === serverId && entry.section === section,
  );
}
