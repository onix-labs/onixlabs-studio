import { READ_ACTIVE_DOCUMENT, REPLACE_ACTIVE_DOCUMENT } from '../../shared/ai-types';
import type { AgentBridge } from './agent-provider';

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
  "You are running inside ONIXLabs Studio and can act on the user's open editor:",
  `- "${READ_ACTIVE_DOCUMENT}" reads the active editor document's text.`,
  `- "${REPLACE_ACTIVE_DOCUMENT}" replaces the active editor document's entire text.`,
  'Prefer these in-app tools when the user is asking about or editing the document they are viewing;',
  'use the file-system tools for broader project work.',
].join('\n');

/**
 * Reads the active editor document through the renderer bridge and renders the result for the model.
 * @param bridge The agent's bridge to the renderer.
 * @returns Returns the document text, or a note that no document is open.
 */
export async function readActiveDocument(bridge: AgentBridge): Promise<string> {
  const result: unknown = await bridge.request(READ_ACTIVE_DOCUMENT, {});
  const read: { available?: boolean; text?: string } = result ?? {};
  return read.available === true ? (read.text ?? '') : 'No active document is open in the editor.';
}

/**
 * Replaces the active editor document through the renderer bridge and renders the result.
 * @param bridge The agent's bridge to the renderer.
 * @param text The new full text.
 * @returns Returns a short confirmation for the model.
 */
export async function replaceActiveDocument(bridge: AgentBridge, text: string): Promise<string> {
  const result: unknown = await bridge.request(REPLACE_ACTIVE_DOCUMENT, { text });
  const replace: { ok?: boolean } = result ?? {};
  return replace.ok === true
    ? 'The active document was updated.'
    : 'There is no active document to update.';
}
