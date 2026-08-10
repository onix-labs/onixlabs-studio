import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../logger';

/**
 * Reads the local Claude login's OAuth access token — the same credential the `claude` CLI uses — so a
 * Studio process can call the claude.ai/code bridge API (#331) on the user's behalf. On macOS the token
 * lives in the Keychain (service `Claude Code-credentials`); elsewhere the CLI writes it to
 * `~/.claude/.credentials.json`. Returns null when no token is available (not logged in, or an
 * unsupported store), which the caller treats as "remote control unavailable" — it never throws.
 * @returns Returns the OAuth access token, or null when unavailable.
 */
export function readClaudeAccessToken(): string | null {
  try {
    const raw: string | null = process.platform === 'darwin' ? readFromKeychain() : readFromFile();
    if (raw === null) {
      return null;
    }
    const parsed: { claudeAiOauth?: { accessToken?: unknown } } = JSON.parse(raw) as {
      claudeAiOauth?: { accessToken?: unknown };
    };
    const token: unknown = parsed.claudeAiOauth?.accessToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch (error: unknown) {
    logger.debug('ClaudeCredentials', 'Could not read the Claude access token', error);
    return null;
  }
}

/**
 * Reads the raw credential JSON from the macOS Keychain, or null when the entry is absent.
 * @returns Returns the credential JSON string, or null.
 */
function readFromKeychain(): string | null {
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch {
    return null;
  }
}

/**
 * Reads the raw credential JSON from `~/.claude/.credentials.json` (Linux/Windows), or null when absent.
 * @returns Returns the credential JSON string, or null.
 */
function readFromFile(): string | null {
  try {
    return readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8');
  } catch {
    return null;
  }
}
