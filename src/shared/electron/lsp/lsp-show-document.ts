import { LspShowDocumentRequest } from '@shared/api/lsp-channels';

/**
 * The schemes a server may ask to show (#1211): a web page, opened in the browser, or a file, opened in
 * an editor. Anything else — `javascript:`, `data:`, a custom scheme handed to the operating system —
 * is refused, as a server is not trusted to open what the user did not ask for.
 */
const WEB_SCHEMES: ReadonlySet<string> = new Set<string>(['http:', 'https:']);

/**
 * Reads a protocol position, untrusted.
 * @param value The candidate.
 * @returns Returns the position, or null when it is not one.
 */
function position(value: unknown): { line: number; character: number } | null {
  const candidate: { line?: unknown; character?: unknown } | null =
    typeof value === 'object' && value !== null ? value : null;
  return Number.isInteger(candidate?.line) &&
    Number.isInteger(candidate?.character) &&
    (candidate?.line as number) >= 0 &&
    (candidate?.character as number) >= 0
    ? { line: candidate?.line as number, character: candidate?.character as number }
    : null;
}

/**
 * Reads a server's `window/showDocument` (#1211) into what the renderer is asked to show: a web page,
 * always in the browser, or a file, in Studio unless the server asks for the operating system's own
 * application — which Studio does not hand a file to, so that request is refused. gopls's Browse
 * Documentation, Browse Assembly and Browse Free Symbols open pages it serves on localhost; its
 * Split Package opens one too.
 * @param sessionId The session whose server asked.
 * @param params The request's parameters, untrusted: `{ uri, external?, takeFocus?, selection? }`.
 * @returns Returns the request to forward, or null when it is not to be shown.
 */
export function toShowDocumentRequest(
  sessionId: string,
  params: unknown,
): LspShowDocumentRequest | null {
  const candidate: { uri?: unknown; external?: unknown; selection?: unknown } | null =
    typeof params === 'object' && params !== null ? params : null;
  if (typeof candidate?.uri !== 'string') {
    return null;
  }
  let url: URL;
  try {
    url = new URL(candidate.uri);
  } catch {
    return null;
  }
  if (WEB_SCHEMES.has(url.protocol)) {
    return { sessionId, uri: url.href, external: true };
  }
  if (url.protocol !== 'file:' || candidate.external === true) {
    return null;
  }
  const range: { start?: unknown; end?: unknown } | null =
    typeof candidate.selection === 'object' && candidate.selection !== null
      ? candidate.selection
      : null;
  const start: { line: number; character: number } | null = position(range?.start);
  const end: { line: number; character: number } | null = position(range?.end);
  return {
    sessionId,
    uri: candidate.uri,
    external: false,
    ...(start === null || end === null ? {} : { selection: { start, end } }),
  };
}
