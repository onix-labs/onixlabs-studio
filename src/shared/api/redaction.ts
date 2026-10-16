// Keeping secrets out of what is written down and what is sent away (audit S7).
//
// Platform-neutral — no Node, no DOM — so both the main process (which writes the log and answers the
// System Monitor agent) and the renderer can use it.

/**
 * The word a secret is replaced with.
 */
const REDACTED: string = '[redacted]';

/**
 * Credentials carried in a URL, as `scheme://user:password@host`. Matched wherever a URL appears in
 * a text, not only at its start.
 */
const URL_CREDENTIALS: RegExp = /([a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/gi;

/**
 * Secrets recognisable by their shape, wherever they appear: the token formats of the services a
 * developer's shell and logs most often hold, and anything a request header or an assignment labels
 * as one. Deliberately a short list of unmistakable shapes rather than a long one of guesses: a false
 * match redacts a word that was not secret, which is harmless; the aim is that the common shapes never
 * get through.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  // GitHub: personal access tokens, fine-grained tokens, OAuth, app, refresh and server tokens.
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // OpenAI and Anthropic keys, project keys included.
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // Slack tokens.
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  // AWS access key ids.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Google API keys.
  /\bAIza[0-9A-Za-z_-]{35,}\b/g,
  // Private key blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/**
 * A value labelled as a secret: an `Authorization` header's credential, or an assignment or field
 * whose name ends in token, secret, password or key (`NPM_TOKEN`, `client_secret`). The label is kept
 * and the value replaced.
 */
const LABELLED_SECRET: RegExp =
  /\b((?:bearer|basic)\s+|[\w-]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|client[_-]?secret|authorization)["']?\s*[=:]\s*["']?)([^\s"',;&]{8,})/gi;

/**
 * Removes the credentials from a URL, leaving the rest as it was: `https://user:token@host/path`
 * becomes `https://host/path`. A string that is not a URL, or carries no credentials, is returned
 * unchanged.
 * @param url The URL.
 * @returns Returns the URL without its credentials.
 */
export function stripUrlCredentials(url: string): string {
  return url.replace(URL_CREDENTIALS, '$1');
}

/**
 * Masks the secrets a text carries: credentials in URLs, tokens recognisable by their shape, and any
 * value labelled as a secret.
 * @param text The text.
 * @returns Returns the text with each secret replaced by `[redacted]`.
 */
export function redactSecrets(text: string): string {
  let result: string = text.replace(URL_CREDENTIALS, `$1${REDACTED}@`);
  for (const shape of SECRET_SHAPES) {
    result = result.replace(shape, REDACTED);
  }
  return result.replace(LABELLED_SECRET, `$1${REDACTED}`);
}
