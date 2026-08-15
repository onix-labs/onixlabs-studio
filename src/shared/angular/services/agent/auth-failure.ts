// Recognises a Claude sign-in failure from a run's error text, so the "not signed in" modal can be
// raised immediately in the renderer without waiting on (or depending on) a main-process auth check.
// This is the fast, IPC-free path; an authoritative `claude auth status` check backs it up for auth
// failures whose wording this does not recognise.

/**
 * The lower-cased substrings that mark an error as a Claude authentication/sign-in failure. Drawn from
 * the shapes the CLI and SDK surface (`Not logged in. Please run /login`, OAuth/token errors, an HTTP
 * 401), kept specific enough that an ordinary tool or network error does not match.
 */
const AUTH_FAILURE_SIGNATURES: readonly string[] = [
  'not logged in',
  'please run /login',
  'run `claude',
  'run /login',
  '/login',
  'oauth',
  'unauthorized',
  'authentication_error',
  'authentication error',
  'invalid api key',
  'invalid x-api-key',
  'setup-token',
  '401',
];

/**
 * Determines whether a run's error text reads as a Claude sign-in failure (an expired or absent login),
 * as opposed to any other failure. Case-insensitive substring match over {@link AUTH_FAILURE_SIGNATURES}.
 * @param detail The failure detail carried by the error status event.
 * @returns Returns true when the text matches a sign-in failure signature.
 */
export function looksLikeAuthFailure(detail: string): boolean {
  const text: string = detail.toLowerCase();
  return AUTH_FAILURE_SIGNATURES.some((signature: string): boolean => text.includes(signature));
}

/**
 * Determines whether an assistant reply *is* the CLI's not-signed-in message (`Not logged in. Please run
 * /login`), as opposed to a normal reply that merely mentions logging in. This is deliberately strict —
 * it anchors on the reply starting with "not logged in" and naming `/login` — because the completed-turn
 * path acts on it destructively (it drops the reply and re-runs), so a false match on genuine content
 * would be harmful. Used only for turns that completed with a reply; the broader
 * {@link looksLikeAuthFailure} covers hard error text.
 * @param reply The assistant reply text.
 * @returns Returns true when the reply is the not-signed-in message.
 */
export function isNotLoggedInReply(reply: string): boolean {
  const text: string = reply.trimStart().toLowerCase();
  return text.startsWith('not logged in') && text.includes('/login');
}
