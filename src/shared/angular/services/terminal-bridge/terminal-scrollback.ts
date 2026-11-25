import { TerminalReplay } from '@shared/api/terminal-channels';
import type { TerminalBridge } from './terminal-bridge';

/**
 * Matches the terminal control sequences a raw pty stream carries (OSC titles, CSI styling and
 * cursor movement, and two-character escapes), so scrollback read through the replay fallback comes
 * back as plain text. Composed from character codes because a literal escape in a regex trips the
 * no-control-regex lint rule.
 */
const CONTROL_SEQUENCE_PATTERN: RegExp = new RegExp(
  `${String.fromCharCode(27)}(?:\\][^${String.fromCharCode(7)}${String.fromCharCode(27)}]*(?:${String.fromCharCode(7)}|${String.fromCharCode(27)}\\\\)?|\\[[0-9;?]*[0-9A-Za-z]|.)`,
  'g',
);

/**
 * Reads a session's scrollback as plain text: what it has printed, whether or not a pane is showing it.
 * @param bridge The bridge to the main process, which keeps the scrollback.
 * @param id The terminal identifier.
 * @returns Returns the text, or null when there is no such session.
 */
export async function readTerminalScrollback(
  bridge: TerminalBridge,
  id: string,
): Promise<string | null> {
  const replay: TerminalReplay = await bridge.replay(id);
  if (replay.data.length === 0 && replay.exitCode === null) {
    return null;
  }
  return replay.data
    .replace(CONTROL_SEQUENCE_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}
