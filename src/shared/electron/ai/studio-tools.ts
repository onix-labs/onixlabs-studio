import {
  DELETE_BINARY_BYTES,
  EDIT_ACTIVE_DOCUMENT,
  INSERT_ACTIVE_DOCUMENT,
  INSERT_BINARY_BYTES,
  InsertPlacement,
  PATCH_BINARY_BYTES,
  READ_ACTIVE_DOCUMENT,
  READ_BINARY_BYTES,
  READ_BINARY_DISASSEMBLY,
  READ_BINARY_OVERVIEW,
  READ_BINARY_SELECTION,
  READ_TERMINAL_OUTPUT,
  REPLACE_ACTIVE_DOCUMENT,
  WRITE_TERMINAL_INPUT,
} from '@shared/api/ai-types';
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
 * The fully-qualified name the string-anchored edit tool is exposed under to the Claude Agent SDK.
 */
export const EDIT_TOOL_FQN: string = `mcp__studio__${EDIT_ACTIVE_DOCUMENT}`;

/**
 * The fully-qualified name the insert tool is exposed under to the Claude Agent SDK.
 */
export const INSERT_TOOL_FQN: string = `mcp__studio__${INSERT_ACTIVE_DOCUMENT}`;

/**
 * The fully-qualified name the read-terminal tool is exposed under to the Claude Agent SDK.
 */
export const READ_TERMINAL_FQN: string = `mcp__studio__${READ_TERMINAL_OUTPUT}`;

/**
 * The fully-qualified name the write-terminal tool is exposed under to the Claude Agent SDK.
 */
export const WRITE_TERMINAL_FQN: string = `mcp__studio__${WRITE_TERMINAL_INPUT}`;

/**
 * The fully-qualified names the read-only binary tools are exposed under to the Claude Agent SDK,
 * auto-allowed so the agent can inspect the binary without prompting.
 */
export const READ_BINARY_OVERVIEW_FQN: string = `mcp__studio__${READ_BINARY_OVERVIEW}`;
export const READ_BINARY_BYTES_FQN: string = `mcp__studio__${READ_BINARY_BYTES}`;
export const READ_BINARY_SELECTION_FQN: string = `mcp__studio__${READ_BINARY_SELECTION}`;
export const READ_BINARY_DISASSEMBLY_FQN: string = `mcp__studio__${READ_BINARY_DISASSEMBLY}`;

/**
 * The fully-qualified name the byte-patching tool is exposed under to the Claude Agent SDK. It is not
 * auto-allowed: it flows through the permission broker so it prompts unless the posture auto-allows.
 */
export const PATCH_BINARY_BYTES_FQN: string = `mcp__studio__${PATCH_BINARY_BYTES}`;

/**
 * The fully-qualified names the length-changing byte tools are exposed under to the Claude Agent SDK.
 * Like the patch tool, they are never auto-allowed: they flow through the permission broker.
 */
export const INSERT_BINARY_BYTES_FQN: string = `mcp__studio__${INSERT_BINARY_BYTES}`;
export const DELETE_BINARY_BYTES_FQN: string = `mcp__studio__${DELETE_BINARY_BYTES}`;

/**
 * Appended to the system prompt so the model knows the in-app editor tools exist and when to use them.
 */
export const STUDIO_PROMPT_APPENDIX: string = [
  'You are running inside ONIXLabs Studio, docked to a specific editor tab, and you can act on that',
  "tab's open document:",
  `- "${READ_ACTIVE_DOCUMENT}" reads this tab's editor document text.`,
  `- "${EDIT_ACTIVE_DOCUMENT}" replaces one exact occurrence of a string with new text (or every`,
  '  occurrence with replace_all). The old string must match the document exactly and uniquely —',
  '  include surrounding context to disambiguate. Delete text by replacing it with an empty string.',
  `- "${INSERT_ACTIVE_DOCUMENT}" inserts text before/after an anchor string, or at the document's`,
  '  start or end.',
  `- "${REPLACE_ACTIVE_DOCUMENT}" replaces this tab's editor document with new text in full.`,
  `For targeted changes, prefer "${EDIT_ACTIVE_DOCUMENT}" and "${INSERT_ACTIVE_DOCUMENT}" over`,
  `"${REPLACE_ACTIVE_DOCUMENT}" — they only touch the region you name. Reserve the full replace for`,
  'rewriting most of a document. When the user asks you to write, generate, or edit code or content',
  'for this tab, put the result in the editor with these tools rather than writing a file to disk —',
  'the document may be unsaved/in memory, and the user wants to see it in their editor. Use the',
  'file-system tools for broader project work (creating other files, reading the repo) and to',
  'save/run when the user asks you to execute.',
].join('\n');

/**
 * Appended to the system prompt for a project-surface run (the standalone agent tab), which has no
 * owning document: the agent works through the provider's built-in tools alone.
 */
export const PROJECT_PROMPT_APPENDIX: string = [
  'You are running inside ONIXLabs Studio as a standalone agent. You are not docked to any editor,',
  'terminal, or document — work through your file-system and shell tools on the project itself.',
  'The working directory is the open workspace root (or the home directory when no workspace is',
  'open). Changes you make to files on disk appear in the IDE: open editors follow external file',
  'changes, and the explorers refresh live.',
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
 * Appended to the system prompt for a binary-surface run, so the model knows it is docked to a single
 * open binary file and acts only through the binary inspection/patch tools.
 */
export const BINARY_PROMPT_APPENDIX: string = [
  'You are running inside ONIXLabs Studio, docked to a single open binary file in the hex editor, and',
  'you act on that file through these tools:',
  `- "${READ_BINARY_OVERVIEW}" describes the file: path, size, container format, architecture, whether`,
  '  disassembly is available, and the current cursor/selection. Call this first to orient yourself.',
  `- "${READ_BINARY_BYTES}" returns a hex + ASCII dump of a byte range (offset and length). The file`,
  '  may be large, so read a window at a time rather than the whole file.',
  `- "${READ_BINARY_SELECTION}" returns a hex + ASCII dump of the bytes the user has selected.`,
  `- "${READ_BINARY_DISASSEMBLY}" returns the assembly listing for a byte range when the format is`,
  '  natively disassemblable; it reports when disassembly is unavailable for the format.',
  `- "${PATCH_BINARY_BYTES}" overwrites bytes at an offset (the length is unchanged). The edit is`,
  '  unsaved and undoable — the user reviews and saves it. Only patch when the user asks you to.',
  `- "${INSERT_BINARY_BYTES}" inserts bytes before an offset and "${DELETE_BINARY_BYTES}" removes a`,
  '  byte range. Both CHANGE THE FILE LENGTH and shift every subsequent offset, which typically',
  '  corrupts structured executables (their headers reference absolute offsets) — use them on blobs',
  '  and data files, prefer the overwrite patch for executables, and re-read after any length change',
  '  because earlier offsets are stale. Only edit when the user asks you to.',
  'Offsets and lengths are byte counts in the file. Prefer these tools over the file-system tools for',
  'inspecting or editing this file, since it may have unsaved edits held in the editor.',
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

/**
 * Applies a string-anchored edit to the owning tab's editor document through the renderer bridge and
 * renders the result. The renderer reports anchor failures (not found, ambiguous) in `detail` so the
 * model can re-read and disambiguate.
 * @param context The agent run context (carries the bridge and the owning tab id).
 * @param oldString The exact text to replace (must match once, unless replacing all).
 * @param newString The replacement text (empty deletes the matched text).
 * @param replaceAll Whether to replace every occurrence instead of requiring a unique match.
 * @returns Returns a short confirmation, or the reason the edit was not applied.
 */
export async function editActiveDocument(
  context: AgentRunContext,
  oldString: string,
  newString: string,
  replaceAll: boolean = false,
): Promise<string> {
  const result: unknown = await context.bridge.request(EDIT_ACTIVE_DOCUMENT, {
    tabId: context.owningTabId,
    oldString,
    newString,
    replaceAll,
  });
  const edit: { ok?: boolean; detail?: string } = result ?? {};
  return (
    edit.detail ??
    (edit.ok === true ? 'The edit was applied.' : 'There is no active document to edit.')
  );
}

/**
 * Inserts text into the owning tab's editor document through the renderer bridge and renders the
 * result.
 * @param context The agent run context (carries the bridge and the owning tab id).
 * @param text The text to insert.
 * @param placement Where to insert: before/after an anchor, or at the document start/end.
 * @param anchor The anchor text for before/after placements (must match exactly once).
 * @returns Returns a short confirmation, or the reason the insert was not applied.
 */
export async function insertIntoActiveDocument(
  context: AgentRunContext,
  text: string,
  placement: InsertPlacement,
  anchor?: string,
): Promise<string> {
  const result: unknown = await context.bridge.request(INSERT_ACTIVE_DOCUMENT, {
    tabId: context.owningTabId,
    text,
    placement,
    anchor,
  });
  const insert: { ok?: boolean; detail?: string } = result ?? {};
  return (
    insert.detail ??
    (insert.ok === true ? 'The text was inserted.' : 'There is no active document to insert into.')
  );
}

/**
 * Requests one of the read-only binary capabilities through the renderer bridge and renders the
 * already-formatted text it returns (the renderer formats the hex/ASCII/assembly, so the formatting
 * lives in one place). The optional byte range is forwarded for the tools that take one.
 * @param context The agent run context (carries the bridge and the owning tab id).
 * @param capability The binary read capability to invoke.
 * @param range The optional `{ offset, length }` range to read.
 * @returns Returns the rendered text, or a note that no binary document is open.
 */
async function readBinary(
  context: AgentRunContext,
  capability: string,
  range?: { offset: number; length: number },
): Promise<string> {
  const result: unknown = await context.bridge.request(capability, {
    tabId: context.owningTabId,
    ...range,
  });
  const read: { available?: boolean; text?: string } = result ?? {};
  return read.available === true ? (read.text ?? '') : 'No binary document is open in this view.';
}

/**
 * Reads an overview of the owning binary document (path, size, format, architecture, disassembly
 * availability, cursor/selection).
 * @param context The agent run context.
 * @returns Returns the overview text, or a note that no binary document is open.
 */
export function readBinaryOverview(context: AgentRunContext): Promise<string> {
  return readBinary(context, READ_BINARY_OVERVIEW);
}

/**
 * Reads a hex + ASCII dump of a byte range of the owning binary document.
 * @param context The agent run context.
 * @param offset The first byte offset to read.
 * @param length The number of bytes to read.
 * @returns Returns the dump text, or a note that no binary document is open.
 */
export function readBinaryBytes(
  context: AgentRunContext,
  offset: number,
  length: number,
): Promise<string> {
  return readBinary(context, READ_BINARY_BYTES, { offset, length });
}

/**
 * Reads a hex + ASCII dump of the owning binary document's current selection.
 * @param context The agent run context.
 * @returns Returns the dump text, a note that nothing is selected, or that no document is open.
 */
export function readBinarySelection(context: AgentRunContext): Promise<string> {
  return readBinary(context, READ_BINARY_SELECTION);
}

/**
 * Reads the assembly listing for a byte range of the owning binary document.
 * @param context The agent run context.
 * @param offset The first byte of the range.
 * @param length The number of bytes in the range.
 * @returns Returns the assembly text, a note that disassembly is unavailable, or that no document is
 * open.
 */
export function readBinaryDisassembly(
  context: AgentRunContext,
  offset: number,
  length: number,
): Promise<string> {
  return readBinary(context, READ_BINARY_DISASSEMBLY, { offset, length });
}

/**
 * Overwrites bytes at an offset in the owning binary document through the renderer bridge, and renders
 * the result for the model.
 * @param context The agent run context.
 * @param offset The offset to overwrite from.
 * @param bytes The replacement bytes as a hex string (for example, `4d 5a` or `4D5A`).
 * @returns Returns a short confirmation, or the reason the patch was rejected.
 */
export async function patchBinaryBytes(
  context: AgentRunContext,
  offset: number,
  bytes: string,
): Promise<string> {
  const result: unknown = await context.bridge.request(PATCH_BINARY_BYTES, {
    tabId: context.owningTabId,
    offset,
    bytes,
  });
  const patch: { ok?: boolean; text?: string } = result ?? {};
  return (
    patch.text ?? (patch.ok === true ? 'The bytes were patched.' : 'The bytes were not patched.')
  );
}

/**
 * Inserts bytes before an offset in the owning binary document through the renderer bridge, growing
 * the file, and renders the result for the model.
 * @param context The agent run context.
 * @param offset The offset to insert before (the file size appends).
 * @param bytes The bytes to insert as a hex string (for example, `4d 5a` or `4D5A`).
 * @returns Returns a short confirmation, or the reason the insert was rejected.
 */
export async function insertBinaryBytes(
  context: AgentRunContext,
  offset: number,
  bytes: string,
): Promise<string> {
  const result: unknown = await context.bridge.request(INSERT_BINARY_BYTES, {
    tabId: context.owningTabId,
    offset,
    bytes,
  });
  const insert: { ok?: boolean; text?: string } = result ?? {};
  return (
    insert.text ??
    (insert.ok === true ? 'The bytes were inserted.' : 'The bytes were not inserted.')
  );
}

/**
 * Deletes a run of bytes from the owning binary document through the renderer bridge, shrinking the
 * file, and renders the result for the model.
 * @param context The agent run context.
 * @param offset The first offset to delete.
 * @param length The number of bytes to delete.
 * @returns Returns a short confirmation, or the reason the delete was rejected.
 */
export async function deleteBinaryBytes(
  context: AgentRunContext,
  offset: number,
  length: number,
): Promise<string> {
  const result: unknown = await context.bridge.request(DELETE_BINARY_BYTES, {
    tabId: context.owningTabId,
    offset,
    length,
  });
  const del: { ok?: boolean; text?: string } = result ?? {};
  return del.text ?? (del.ok === true ? 'The bytes were deleted.' : 'The bytes were not deleted.');
}
