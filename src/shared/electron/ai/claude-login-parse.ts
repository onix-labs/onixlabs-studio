// Pure parsing helpers for the in-app Claude login flow, split out from the driver so they carry no
// `node-pty`/`electron` dependency and can be unit-tested in isolation. The driver ({@link ./claude-login})
// composes these with the process spawning.

import type { ClaudeAuthStatus } from '@shared/api/ai-types';

/**
 * Parses the JSON emitted by `claude auth status --json` into the app's {@link ClaudeAuthStatus}. Any
 * shape that is not an explicit `loggedIn: true` reads as signed-out, so a changed or unreadable payload
 * fails safe (the modal offers login rather than silently assuming a session).
 * @param stdout The command's standard output.
 * @returns Returns the parsed status.
 */
export function parseLoggedIn(stdout: string): ClaudeAuthStatus {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (typeof parsed !== 'object' || parsed === null) {
      return { loggedIn: false };
    }
    const record: Record<string, unknown> = parsed as Record<string, unknown>;
    const loggedIn: boolean = record['loggedIn'] === true;
    const email: unknown = record['email'];
    return typeof email === 'string' && email.length > 0 ? { loggedIn, email } : { loggedIn };
  } catch {
    return { loggedIn: false };
  }
}

/**
 * Extracts the first sign-in URL from a chunk of CLI output, for a manual "open sign-in page" fallback
 * when the CLI could not open the browser itself. Matches an `https://` link and trims trailing
 * punctuation the terminal may have wrapped it in.
 * @param text The accumulated CLI output.
 * @returns Returns the URL, or undefined when none is present.
 */
export function extractLoginUrl(text: string): string | undefined {
  const match: RegExpExecArray | null = /https:\/\/[^\s'"]+/.exec(text);
  if (match === null) {
    return undefined;
  }
  return match[0].replace(/[).,'"\]]+$/, '');
}
