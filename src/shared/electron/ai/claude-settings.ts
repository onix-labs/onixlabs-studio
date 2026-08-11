import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../logger';

/**
 * The Claude Code user settings file the CLI reads. Studio surfaces a couple of its keys (the
 * remote-control push preferences) so they can be toggled from Studio's own settings UI (#331).
 */
const SETTINGS_PATH: string = join(homedir(), '.claude', 'settings.json');

/**
 * The Claude Code setting that pushes to the user's mobile when a remote-controlled agent needs input —
 * a permission prompt or a question (the `/config` "Push when actions required" toggle). This is an
 * account-level preference (Studio attaches its own bridge worker, so a per-session overlay would not
 * reach it), which is why Studio reads and writes it here rather than through the SDK run options.
 */
const INPUT_NEEDED_KEY: string = 'inputNeededNotifEnabled';

/**
 * Reads the whole Claude Code user settings object, or an empty object when the file is absent or
 * unreadable/malformed. Best-effort — never throws.
 * @returns Returns the parsed settings object.
 */
function readSettings(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch (error: unknown) {
    logger.debug('ClaudeSettings', 'Could not read Claude settings', error);
    return {};
  }
}

/**
 * Reads whether Claude Code's mobile push for a remote-controlled agent needing input is enabled.
 * @returns Returns true when {@link INPUT_NEEDED_KEY} is enabled, false otherwise (or on any failure).
 */
export function readRemoteNotificationsEnabled(): boolean {
  return readSettings()[INPUT_NEEDED_KEY] === true;
}

/**
 * Enables or disables Claude Code's mobile push for a remote-controlled agent needing input, merging the
 * one key into the user's settings file and preserving everything else. Best-effort — a failure is
 * logged and swallowed (the toggle simply does not persist).
 * @param enabled Whether to enable the push.
 */
export function writeRemoteNotificationsEnabled(enabled: boolean): void {
  const settings: Record<string, unknown> = readSettings();
  settings[INPUT_NEEDED_KEY] = enabled;
  try {
    writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    logger.info(
      'ClaudeSettings',
      `Remote-control mobile push ${enabled ? 'enabled' : 'disabled'} (${INPUT_NEEDED_KEY})`,
    );
  } catch (error: unknown) {
    logger.warn('ClaudeSettings', 'Could not write the remote-notification preference', error);
  }
}
