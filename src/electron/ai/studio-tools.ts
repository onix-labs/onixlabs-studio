import { READ_ACTIVE_DOCUMENT, REPLACE_ACTIVE_DOCUMENT } from '../../shared/ai-types';
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
