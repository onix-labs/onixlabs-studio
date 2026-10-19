import { LspSemanticTokensLegend } from '@shared/api/lsp-channels';
import type { LspCodeActionSupport, LspRenameSupport } from './lsp-features';

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
