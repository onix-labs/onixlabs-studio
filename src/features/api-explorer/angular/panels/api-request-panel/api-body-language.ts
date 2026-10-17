import { HttpBodyKind } from '@shared/api/api-client-types';

/**
 * Resolves the Monaco language a request body of a kind is edited as. The text kinds map to their
 * own grammar; the form kinds have no text and the absent body none, so they fall back to plain text.
 * @param kind The body kind.
 * @returns Returns the Monaco language identifier.
 */
export function languageForBodyKind(kind: HttpBodyKind): string {
  switch (kind) {
    case 'json':
      return 'json';
    case 'xml':
      return 'xml';
    default:
      return 'plaintext';
  }
}

/**
 * Resolves the Monaco language a response body is shown as, from the response's content type. The
 * structured suffix forms (`application/problem+json`, `image/svg+xml`) count as their base grammar;
 * anything unrecognised is plain text rather than a guess.
 * @param contentType The response's `Content-Type` header, or undefined when it sent none.
 * @returns Returns the Monaco language identifier.
 */
export function languageForContentType(contentType: string | undefined): string {
  const type: string = (contentType ?? '').split(';', 1)[0].trim().toLowerCase();
  if (type.length === 0) {
    return 'plaintext';
  }
  if (type.endsWith('/json') || type.endsWith('+json')) {
    return 'json';
  }
  // Before the XML suffix form, which XHTML would otherwise match.
  if (type === 'text/html' || type === 'application/xhtml+xml') {
    return 'html';
  }
  if (type.endsWith('/xml') || type.endsWith('+xml')) {
    return 'xml';
  }
  if (type === 'text/css') {
    return 'css';
  }
  if (type === 'text/javascript' || type === 'application/javascript') {
    return 'javascript';
  }
  if (type.endsWith('/yaml') || type.endsWith('+yaml') || type === 'text/x-yaml') {
    return 'yaml';
  }
  return 'plaintext';
}
