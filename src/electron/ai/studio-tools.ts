import {
  READ_ACTIVE_DOCUMENT,
  READ_TERMINAL_OUTPUT,
  REPLACE_ACTIVE_DOCUMENT,
  WRITE_TERMINAL_INPUT,
} from '../../shared/ai-types';
import type { AgentRunContext } from './agent-provider';

/**
 * The fully-qualified name the read tool is exposed under to the Claude Agent SDK
 * (`mcp__<server>__<tool>`), used to auto-allow it.
 */
export const READ_TOOL_FQN: string = `mcp__studio__${READ_ACTIVE_DOCUMENT}`;

/**
 * The fully-qualified name the replace tool is exposed under to the Claude Agent SDK.
 */
export const REPLACE_TOOL_FQN: string = `mcp__studio__${REPLACE_ACTIVE_DOCUMENT}`;

/**
 * The fully-qualified name the read-terminal tool is exposed under to the Claude Agent SDK.
 */
export const READ_TERMINAL_FQN: string = `mcp__studio__${READ_TERMINAL_OUTPUT}`;

/**
 * The fully-qualified name the write-terminal tool is exposed under to the Claude Agent SDK.
 */
export const WRITE_TERMINAL_FQN: string = `mcp__studio__${WRITE_TERMINAL_INPUT}`;

/**
 * Appended to the system prompt so the model knows the in-app editor tools exist and when to use them.
 */
export const STUDIO_PROMPT_APPENDIX: string = [
  'You are running inside ONIXLabs Studio, docked to a specific editor tab, and you can act on that',
  "tab's open document:",
  `- "${READ_ACTIVE_DOCUMENT}" reads this tab's editor document text.`,
  `- "${REPLACE_ACTIVE_DOCUMENT}" replaces this tab's editor document with new text.`,
  'When the user asks you to write, generate, or edit code or content for this tab, put the result in',
  'the editor with these tools rather than writing a file to disk — the document may be unsaved/in',
  'memory, and the user wants to see it in their editor. Use the file-system tools for broader project',
  'work (creating other files, reading the repo) and to save/run when the user asks you to execute.',
].join('\n');

/**
 * Appended to the system prompt for a terminal-surface run, so the model knows it acts only through
 * the owning terminal.
 */
export const TERMINAL_PROMPT_APPENDIX: string = [
  'You are running inside ONIXLabs Studio, docked to a single terminal session, and you act ONLY',
  'through that terminal — you have no file-system, editor, or shell tools other than these two:',
  `- "${READ_TERMINAL_OUTPUT}" returns the recent output currently shown in the terminal.`,
  `- "${WRITE_TERMINAL_INPUT}" types text into the terminal (running it as a command by default).`,
  'Do everything by running commands in this terminal: to inspect files run shell commands (ls, cat,',
  'grep), to change files use shell tools (sed, an editor), to run code execute it here. After',
  'sending a command, read the output to see the result; for long-running commands, read again until',
  'it finishes. The user is watching this terminal live.',
].join('\n');

/**
 * Reads the owning terminal's recent output through the renderer bridge and renders it for the model.
 * @param context The agent run context (carries the bridge and the owning terminal id).
 * @returns Returns the recent terminal output, or a note that the terminal is unavailable.
 */
export async function readTerminalOutput(context: AgentRunContext): Promise<string> {
  const result: unknown = await context.bridge.request(READ_TERMINAL_OUTPUT, {
    tabId: context.owningTabId,
  });
  const read: { available?: boolean; text?: string } = result ?? {};
  return read.available === true ? (read.text ?? '') : 'The terminal is not available.';
}

/**
 * Sends input to the owning terminal through the renderer bridge and returns the resulting output.
 * @param context The agent run context (carries the bridge and the owning terminal id).
 * @param text The input to send.
 * @param submit Whether to run the input as a command (append a newline). Defaults to true.
 * @returns Returns the terminal output after the input settles, or a note that the terminal is
 * unavailable.
 */
export async function writeTerminalInput(
  context: AgentRunContext,
  text: string,
  submit: boolean = true,
): Promise<string> {
  const result: unknown = await context.bridge.request(WRITE_TERMINAL_INPUT, {
    tabId: context.owningTabId,
    text,
    submit,
  });
  const write: { ok?: boolean; output?: string } = result ?? {};
  return write.ok === true
    ? (write.output ?? 'Sent to the terminal.')
    : 'The terminal is not available.';
}

/**
 * Reads the owning tab's editor document through the renderer bridge and renders the result for the
 * model.
 * @param context The agent run context (carries the bridge and the owning tab id).
 * @returns Returns the document text, or a note that no document is open.
 */
export async function readActiveDocument(context: AgentRunContext): Promise<string> {
  const result: unknown = await context.bridge.request(READ_ACTIVE_DOCUMENT, {
    tabId: context.owningTabId,
  });
  const read: { available?: boolean; text?: string } = result ?? {};
  return read.available === true ? (read.text ?? '') : 'No active document is open in the editor.';
}

/**
 * Replaces the owning tab's editor document through the renderer bridge and renders the result.
 * @param context The agent run context (carries the bridge and the owning tab id).
 * @param text The new full text.
 * @returns Returns a short confirmation for the model.
 */
export async function replaceActiveDocument(
  context: AgentRunContext,
  text: string,
): Promise<string> {
  const result: unknown = await context.bridge.request(REPLACE_ACTIVE_DOCUMENT, {
    text,
    tabId: context.owningTabId,
  });
  const replace: { ok?: boolean } = result ?? {};
  return replace.ok === true
    ? 'The active document was updated.'
    : 'There is no active document to update.';
}
