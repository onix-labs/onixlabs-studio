import { LspSemanticTokensLegend } from '@shared/api/lsp-channels';

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
