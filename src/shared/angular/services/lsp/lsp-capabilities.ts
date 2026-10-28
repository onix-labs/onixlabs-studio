import { LspSemanticTokensLegend } from '@shared/api/lsp-channels';
import type {
  LspCodeActionSupport,
  LspFormattingSupport,
  LspInlayHintSupport,
  LspNavigationSupport,
  LspRenameSupport,
} from './lsp-features';

/**
 * Extracts the semantic token legend from a server's initialize capabilities, or null when the server
 * does not advertise a semantic tokens provider with a legend.
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns the legend, or null.
 */
export function semanticLegendOf(capabilities: unknown): LspSemanticTokensLegend | null {
  const provider: unknown = (capabilities as { semanticTokensProvider?: unknown } | undefined)
    ?.semanticTokensProvider;
  const legend: unknown = (provider as { legend?: unknown } | undefined)?.legend;
  const candidate: { tokenTypes?: unknown; tokenModifiers?: unknown } | undefined = legend as
    { tokenTypes?: unknown; tokenModifiers?: unknown } | undefined;
  if (
    candidate === undefined ||
    !Array.isArray(candidate.tokenTypes) ||
    !Array.isArray(candidate.tokenModifiers)
  ) {
    return null;
  }
  return {
    tokenTypes: candidate.tokenTypes as readonly string[],
    tokenModifiers: candidate.tokenModifiers as readonly string[],
  };
}

/**
 * Determines whether a server advertises pull diagnostics (a `diagnosticProvider`), so the client
 * requests diagnostics via `textDocument/diagnostic` rather than waiting for pushed
 * `publishDiagnostics`. Pull-based servers (notably Roslyn) surface compile errors only this way.
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns true when the server supports pull diagnostics.
 */
/**
 * Determines whether a server asked for the document's text to accompany `textDocument/didSave`
 * (`textDocumentSync.save.includeText`). The protocol allows the text only when the server asked.
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns true when saves should carry the full text.
 */
export function saveIncludesText(capabilities: unknown): boolean {
  const sync: unknown = (capabilities as { textDocumentSync?: unknown } | undefined)
    ?.textDocumentSync;
  const save: unknown = (sync as { save?: unknown } | undefined)?.save;
  return (save as { includeText?: unknown } | undefined)?.includeText === true;
}

export function supportsPullDiagnostics(capabilities: unknown): boolean {
  const provider: unknown = (capabilities as { diagnosticProvider?: unknown } | undefined)
    ?.diagnosticProvider;
  return provider !== undefined && provider !== null;
}

/**
 * Reads how a server renames a symbol (#1015) from its `renameProvider`: not at all when it has none,
 * after saying first whether a symbol can be renamed when it advertises `prepareProvider`, and
 * straight away otherwise.
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns how the server renames.
 */
export function renameSupportOf(capabilities: unknown): LspRenameSupport {
  const provider: unknown = (capabilities as { renameProvider?: unknown } | undefined)
    ?.renameProvider;
  if (provider === true) {
    return 'rename';
  }
  if (typeof provider !== 'object' || provider === null) {
    return 'none';
  }
  return (provider as { prepareProvider?: unknown }).prepareProvider === true
    ? 'prepare'
    : 'rename';
}

/**
 * Reads how a server offers code actions (#1016) from its `codeActionProvider`: not at all when it has
 * none, with their edits filled in on request when it advertises `resolveProvider`, and whole
 * otherwise.
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns how the server offers code actions.
 */
export function codeActionSupportOf(capabilities: unknown): LspCodeActionSupport {
  const provider: unknown = (capabilities as { codeActionProvider?: unknown } | undefined)
    ?.codeActionProvider;
  if (provider === true) {
    return 'actions';
  }
  if (typeof provider !== 'object' || provider === null) {
    return 'none';
  }
  return (provider as { resolveProvider?: unknown }).resolveProvider === true
    ? 'resolve'
    : 'actions';
}

/**
 * Determines whether a server capability is offered: `true`, or an options object.
 * @param provider The capability, untrusted.
 * @returns Returns true when it is offered.
 */
function isOffered(provider: unknown): boolean {
  return provider === true || (typeof provider === 'object' && provider !== null);
}

/**
 * Reads which of the navigations beyond Go to Definition a server answers (#1142): from a symbol to
 * the code that implements it (`implementationProvider`), and to the declaration of its type
 * (`typeDefinitionProvider`).
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns which it answers.
 */
export function navigationSupportOf(capabilities: unknown): LspNavigationSupport {
  const caps: { implementationProvider?: unknown; typeDefinitionProvider?: unknown } | undefined =
    capabilities as typeof caps;
  return {
    implementation: isOffered(caps?.implementationProvider),
    typeDefinition: isOffered(caps?.typeDefinitionProvider),
  };
}

/**
 * Reads how a server formats code (#1141): a whole document (`documentFormattingProvider`), a range
 * (`documentRangeFormattingProvider`), and as the user types (`documentOnTypeFormattingProvider`, on
 * the characters it names — Roslyn's are `}`, `;` and a newline).
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns how the server formats.
 */
export function formattingSupportOf(capabilities: unknown): LspFormattingSupport {
  const caps:
    | {
        documentFormattingProvider?: unknown;
        documentRangeFormattingProvider?: unknown;
        documentOnTypeFormattingProvider?: unknown;
      }
    | undefined = capabilities as typeof caps;
  const onType: unknown = caps?.documentOnTypeFormattingProvider;
  const first: unknown = (onType as { firstTriggerCharacter?: unknown } | undefined)
    ?.firstTriggerCharacter;
  const more: unknown = (onType as { moreTriggerCharacter?: unknown } | undefined)
    ?.moreTriggerCharacter;
  const candidates: readonly unknown[] = [
    first,
    ...(Array.isArray(more) ? (more as unknown[]) : []),
  ];
  const triggers: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length === 1 && !triggers.includes(candidate)) {
      triggers.push(candidate);
    }
  }
  return {
    document: isOffered(caps?.documentFormattingProvider),
    range: isOffered(caps?.documentRangeFormattingProvider),
    onTypeTriggers: triggers,
  };
}

/**
 * Reads how a server sets hints into the code (#1145) from its `inlayHintProvider`.
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns how it does, or undefined when it does not.
 */
export function inlayHintSupportOf(capabilities: unknown): LspInlayHintSupport | undefined {
  const provider: unknown = (capabilities as { inlayHintProvider?: unknown } | undefined)
    ?.inlayHintProvider;
  if (!isOffered(provider)) {
    return undefined;
  }
  return { resolve: (provider as { resolveProvider?: unknown }).resolveProvider === true };
}

/**
 * Reads the commands a server runs through `workspace/executeCommand` (#1016) from its
 * `executeCommandProvider`. A code action's command is sent to the server only when it is one of
 * these; any other is the client's to run, and Studio runs none of a server's client commands.
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns the command identifiers, or empty when the server runs none.
 */
export function executeCommandsOf(capabilities: unknown): readonly string[] {
  const provider: unknown = (capabilities as { executeCommandProvider?: unknown } | undefined)
    ?.executeCommandProvider;
  const commands: unknown = (provider as { commands?: unknown } | undefined)?.commands;
  return Array.isArray(commands)
    ? commands.filter((command: unknown): command is string => typeof command === 'string')
    : [];
}
