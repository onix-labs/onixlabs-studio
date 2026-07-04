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
    | { tokenTypes?: unknown; tokenModifiers?: unknown }
    | undefined;
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
