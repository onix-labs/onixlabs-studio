import {
  ASK_USER,
  CANCEL_EDIT_PREVIEW,
  COMMIT_EDIT_PREVIEW,
  PREVIEW_ACTIVE_DOCUMENT_EDIT,
  CREATE_API_REQUEST,
  DELETE_BINARY_BYTES,
  DELETE_RUN_CONFIGURATIONS,
  LIST_API_REQUESTS,
  SEND_API_REQUEST,
  SET_API_VARIABLE,
  UPDATE_API_REQUEST,
  EDIT_ACTIVE_DOCUMENT,
  INSERT_ACTIVE_DOCUMENT,
  INSERT_BINARY_BYTES,
  InsertPlacement,
  LIST_RUN_CONFIGURATIONS,
  PATCH_BINARY_BYTES,
  READ_ACTIVE_DOCUMENT,
  RUN_ACTIVE_DOCUMENT,
  SET_ACTIVE_DOCUMENT_LANGUAGE,
  READ_BINARY_BYTES,
  READ_BINARY_DISASSEMBLY,
  READ_BINARY_OVERVIEW,
  READ_BINARY_SELECTION,
  READ_TERMINAL_OUTPUT,
  REPLACE_ACTIVE_DOCUMENT,
  SAVE_RUN_CONFIGURATIONS,
  WRITE_BINARY_ASSEMBLY,
  WRITE_TERMINAL_INPUT,
  type AgentContextRef,
  type AiInputChoice,
} from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
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
 * The fully-qualified name the set-language tool is exposed under to the Claude Agent SDK.
 */
export const SET_LANGUAGE_TOOL_FQN: string = `mcp__studio__${SET_ACTIVE_DOCUMENT_LANGUAGE}`;

// The run-file tool is intentionally NOT auto-allowed (no FQN in `allowedTools`): running code is an
// execution, so it flows through the permission gate and prompts unless the posture auto-allows
// everything, matching write_terminal_input.

/**
 * The default and maximum time (seconds) a run tool waits for the program to finish before returning
 * with whatever output it has. Bounded so a hung program cannot block the run indefinitely.
 */
export const RUN_DEFAULT_TIMEOUT_SECONDS: number = 60;
export const RUN_MAX_TIMEOUT_SECONDS: number = 300;

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
 * The fully-qualified name the assembly-writing tool is exposed under to the Claude Agent SDK. Like the
 * other binary write tools it is never auto-allowed: it flows through the permission broker.
 */
export const WRITE_BINARY_ASSEMBLY_FQN: string = `mcp__studio__${WRITE_BINARY_ASSEMBLY}`;

/**
 * The fully-qualified name the ask-user tool is exposed under to the Claude Agent SDK. Auto-allowed on
 * every surface: asking is not a mutation, and the user's answer is itself the gate.
 */
export const ASK_USER_FQN: string = `mcp__studio__${ASK_USER}`;

/**
 * The fully-qualified tool name of the read-only run-configuration listing, auto-allowed like the
 * other read-only in-app tools.
 */
export const LIST_RUN_CONFIGURATIONS_FQN: string = `mcp__studio__${LIST_RUN_CONFIGURATIONS}`;

/**
 * The fully-qualified name the API-listing tool is exposed under to the Claude Agent SDK. Reading the
 * collections is auto-allowed; creating, updating and sending are not.
 */
export const LIST_API_REQUESTS_FQN: string = `mcp__studio__${LIST_API_REQUESTS}`;

/**
 * The fully-qualified tool names of the mutating run-configuration tools, which go through the
 * permission gate like any other write.
 */
export const SAVE_RUN_CONFIGURATIONS_FQN: string = `mcp__studio__${SAVE_RUN_CONFIGURATIONS}`;
export const DELETE_RUN_CONFIGURATIONS_FQN: string = `mcp__studio__${DELETE_RUN_CONFIGURATIONS}`;

/**
 * The description the ask-user tool is registered with, shared by the Claude and AI-SDK providers so
 * the model sees one contract everywhere.
 */
export const ASK_USER_DESCRIPTION: string =
  'Ask the user a question and wait for their answer. Use it when you need a decision only the user ' +
  'can make: a choice between approaches, a missing name or value, or confirmation before something ' +
  'destructive or hard to reverse. Provide choices when the sensible answers are enumerable — each ' +
  'with a short label and a description explaining the trade-off; put a recommended choice first and ' +
  'note "(recommended)" in its description. The user can always answer with their own text instead. ' +
  'Do not use it to ask for permission to run a tool (permission prompts are separate), and do not ' +
  'ask when the answer is derivable from the context you already have.';

/**
 * Appended to the system prompt on a chat-mode (read-only) run, telling the model it may inspect but
 * must not modify files or run commands. Shared by every provider so chat mode reads the same
 * everywhere.
 */
export const READ_ONLY_APPENDIX: string =
  'You are in read-only chat mode. You may inspect the project and the active surface, but you must ' +
  'not modify files or run commands — editing and executing tools are disabled. Answer, explain, and ' +
  'advise instead of acting.';

/**
 * Builds the prompt for a run: the user's prompt preceded by the attached context — files and
 * folders referenced by path (for the agent's own file tools) and editor selections inlined verbatim
 * (so they reach every provider, including those without file tools). Shared by every provider so
 * attached context behaves identically across them.
 * @param context The run context.
 * @returns Returns the prompt to send.
 */
export function buildRunPrompt(context: AgentRunContext): string {
  const sections: string[] = [];
  const paths: readonly AgentContextRef[] = context.contextPaths.filter(
    (ref: AgentContextRef): boolean => ref.kind !== 'selection',
  );
  if (paths.length > 0) {
    const lines: string = paths
      .map((ref: AgentContextRef): string => ` - ${ref.path} (${ref.kind})`)
      .join('\n');
    sections.push(
      'The user attached the following context. Read the files and explore the folders with your ' +
        `file tools (Read, Glob, Grep) as needed to answer:\n${lines}`,
    );
  }
  for (const ref of context.contextPaths) {
    if (ref.kind === 'selection' && typeof ref.content === 'string' && ref.content.length > 0) {
      sections.push(
        `The user attached this editor selection (${ref.path}):\n"""\n${ref.content}\n"""`,
      );
    }
  }
  sections.push(context.prompt);
  return sections.join('\n\n');
}

/**
 * Appended to every surface's system prompt so the model knows it can ask the user questions instead
 * of guessing.
 */
export const ASK_USER_PROMPT_APPENDIX: string = [
  `When you need the user's decision — a choice between approaches, a missing name or value, or`,
  `confirmation before something destructive — ask them with the "${ASK_USER}" tool and wait for the`,
  'answer rather than guessing or proceeding on an assumption. Keep questions short and concrete,',
  'and offer choices when the sensible answers are enumerable.',
].join('\n');

/**
 * Appended to a provider that asks clarifying questions through the model's own built-in question tool
 * (Claude's `AskUserQuestion`) rather than a named in-app tool, so it is not steered to a specific tool.
 * Kept tool-agnostic on purpose — the model already knows how to ask; this only tells it to ask instead
 * of guessing.
 */
export const CLARIFYING_QUESTION_APPENDIX: string = [
  `When you need the user's decision — a choice between approaches, a missing name or value, or`,
  'confirmation before something destructive — ask a clarifying question and wait for the answer',
  'rather than guessing or proceeding on an assumption. Keep questions short and concrete, and offer',
  'choices when the sensible answers are enumerable.',
].join('\n');

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
  `- "${SET_ACTIVE_DOCUMENT_LANGUAGE}" sets this tab's language (syntax) — use it when you write code`,
  '  in a language the editor is not yet set to.',
  `- "${RUN_ACTIVE_DOCUMENT}" runs this tab's file in the code view's terminal and returns the output`,
  '  and exit status, so you can check whether it ran successfully. Use it after writing or fixing',
  '  code to verify it works; it runs the live editor content, so put your changes in the editor',
  '  first. Runnable languages include JavaScript, TypeScript, Python, C#, Java, Kotlin, Rust, Go,',
  '  and shell.',
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
 * Appended to the system prompt wherever the run-configuration tools are registered, so the model knows
 * the schema it is authoring, the house rules, and — crucially — that it should verify what it writes
 * rather than pattern-match a manifest. This is the whole point of the feature: Studio deliberately
 * stopped guessing run configurations, and an agent that guesses just as badly is no improvement.
 */
export const RUN_CONFIGURATION_PROMPT_APPENDIX: string = [
  "You can author the open workspace's run configurations — the entries in its Run dropdown, persisted",
  'in `.studio/workspace.json`:',
  `- "${LIST_RUN_CONFIGURATIONS}" lists what already exists. Call it first, so you amend rather than`,
  '  duplicate.',
  `- "${SAVE_RUN_CONFIGURATIONS}" creates or updates configurations; entries are matched by id, so`,
  '  saving an existing id replaces that configuration and a new id appends one.',
  `- "${DELETE_RUN_CONFIGURATIONS}" removes configurations by id.`,
  'A configuration is an object: `id` (stable, kebab-case, unique), `name` (what the user reads in the',
  'dropdown), `providerKind` (the ecosystem: dotnet, node, jvm, cpp, rust, go — or `compound`), `mode`',
  '("run" or "debug"), and optionally `program` + `args` (the command to launch), `cwd` (relative to the',
  'workspace root), and `env`. When `program` is given it wins; otherwise the provider derives the',
  'command from the kind and id (for example `node` runs `npm run <id>`, `dotnet` runs',
  '`dotnet run --project <id>`).',
  'A configuration may instead be a **compound**: give it `members` — the ids of other configurations —',
  'and starting it starts all of them in parallel, each individually stoppable. When the user says they',
  'need several things running together, author the individual configurations AND a compound that starts',
  'them, rather than leaving them to press Start three times.',
  'House rules: verify before you write — read the manifests, scripts, and project files, and check that',
  'a path or script you name actually exists. Do not invent configurations for things that cannot be run',
  '(a library with no entry point, a lint script the user did not ask for) merely because a manifest',
  'lists them. Prefer a handful of configurations a developer would actually press over an exhaustive',
  'dump. Names are for humans: "API (watch)" beats "start:dev". If the workspace is one you cannot make',
  'sense of, say so instead of authoring guesses.',
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
  `- "${WRITE_BINARY_ASSEMBLY}" assembles x86/x64 assembly text (e.g. "mov eax, 1" then "ret", one`,
  '  instruction per line, Intel syntax) and writes it at an offset, so you edit at the instruction',
  '  level instead of hand-assembling hex for the patch tool. It keeps the file length unchanged: pass',
  '  the length of the range you are replacing — shorter code is padded with NOPs, and longer code is',
  '  rejected (it would shift the following instructions) so you can revise. It reports the bytes',
  '  written and disassembles them back. Assembly covers x86 and x64 only (ARM/ARM64 can be read but',
  '  not assembled); code is assembled at address 0, so use PC-relative operands for branches. Prefer',
  '  it for x86/x64 code edits. Only edit when the user asks you to.',
  'Offsets and lengths are byte counts in the file. Prefer these tools over the file-system tools for',
  'inspecting or editing this file, since it may have unsaved edits held in the editor.',
].join('\n');

/**
 * Lists the open workspace's run configurations through the renderer bridge and renders them for the
 * model as JSON (the same shape the save tool accepts, so the model can round-trip an edit).
 * @param context The agent run context (carries the bridge).
 * @returns Returns the configurations, or a note that no workspace is open.
 */
export async function listRunConfigurations(context: AgentRunContext): Promise<string> {
  logger.trace('StudioTools', 'Tool invoked: list_run_configurations');
  const result: unknown = await context.bridge.request(LIST_RUN_CONFIGURATIONS, {});
  const read: { available?: boolean; root?: string; configurations?: unknown[] } = result ?? {};
  if (read.available !== true) {
    logger.debug('StudioTools', 'list_run_configurations: no workspace open');
    return 'No workspace folder is open, so there are no run configurations.';
  }
  const configurations: unknown[] = read.configurations ?? [];
  logger.debug('StudioTools', `list_run_configurations: ${configurations.length} configuration(s)`);
  if (configurations.length === 0) {
    return `The workspace at ${read.root ?? 'the open root'} has no run configurations yet.`;
  }
  return `The workspace at ${read.root ?? 'the open root'} has these run configurations:\n${JSON.stringify(
    configurations,
    null,
    2,
  )}`;
}

/**
 * Creates or updates run configurations through the renderer bridge and renders the outcome. The
 * renderer validates the resulting set as a whole, so a refusal comes back as a reason the model can
 * act on rather than a silent partial write.
 * @param context The agent run context (carries the bridge).
 * @param configurations The configurations to create or update.
 * @returns Returns a confirmation, or the reason the write was refused.
 */
export async function saveRunConfigurations(
  context: AgentRunContext,
  configurations: readonly unknown[],
): Promise<string> {
  logger.trace(
    'StudioTools',
    `Tool invoked: save_run_configurations (${configurations.length} config(s))`,
  );
  const result: unknown = await context.bridge.request(SAVE_RUN_CONFIGURATIONS, { configurations });
  const write: { ok?: boolean; error?: string; ids?: string[] } = result ?? {};
  if (write.ok !== true) {
    logger.warn(
      'StudioTools',
      `save_run_configurations refused: ${write.error ?? 'unknown reason'}`,
    );
    return write.error ?? 'The run configurations could not be saved.';
  }
  const ids: string[] = write.ids ?? [];
  logger.info('StudioTools', `Saved ${ids.length} run configuration(s): ${ids.join(', ')}`);
  return `Saved ${ids.length} run configuration(s): ${ids.join(', ')}. They are now in the workspace's Run dropdown.`;
}

/**
 * Deletes run configurations by id through the renderer bridge and renders the outcome.
 * @param context The agent run context (carries the bridge).
 * @param ids The ids of the configurations to delete.
 * @returns Returns a confirmation, or the reason the deletion was refused.
 */
export async function deleteRunConfigurations(
  context: AgentRunContext,
  ids: readonly string[],
): Promise<string> {
  logger.trace('StudioTools', `Tool invoked: delete_run_configurations (${ids.length} id(s))`);
  const result: unknown = await context.bridge.request(DELETE_RUN_CONFIGURATIONS, { ids });
  const write: { ok?: boolean; error?: string; ids?: string[] } = result ?? {};
  if (write.ok === true) {
    logger.info(
      'StudioTools',
      `Deleted ${write.ids?.length ?? 0} run configuration(s): ${(write.ids ?? []).join(', ')}`,
    );
    return `Deleted ${write.ids?.length ?? 0} run configuration(s): ${(write.ids ?? []).join(', ')}.`;
  }
  logger.warn(
    'StudioTools',
    `delete_run_configurations refused: ${write.error ?? 'unknown reason'}`,
  );
  return write.error ?? 'The run configurations could not be deleted.';
}

/**
 * Asks the user a question through the run context's input round-trip and renders their answer for
 * the model. Blocks until the user answers, declines, or the run aborts.
 * @param context The agent run context (carries the input request round-trip).
 * @param question The question to ask.
 * @param choices The suggested answers, or empty for a free-form question.
 * @returns Returns the user's answer, or a note that they declined to answer.
 */
export async function askUser(
  context: AgentRunContext,
  question: string,
  choices: readonly AiInputChoice[],
): Promise<string> {
  logger.trace('StudioTools', `Tool invoked: ask_user (${choices.length} choice(s))`);
  const answer: string | null = await context.requestInput(question, choices);
  logger.debug('StudioTools', `ask_user: ${answer === null ? 'user declined' : 'user answered'}`);
  return formatAskUserAnswer(answer);
}

/**
 * Renders an `ask_user` answer for the model: the user's text, or a note to proceed conservatively
 * when they declined. Shared so a remote-controlled run that resolves the question from a remote device (a
 * peer's inbound message) formats it identically to the local path.
 * @param answer The user's answer, or null when they declined / the question was dismissed.
 * @returns Returns the model-facing rendering of the answer.
 */
export function formatAskUserAnswer(answer: string | null): string {
  return answer === null
    ? 'The user declined to answer. Continue without this information, choosing conservatively.'
    : `The user answered: ${answer}`;
}

/**
 * Reads the owning terminal's recent output through the renderer bridge and renders it for the model.
 * @param context The agent run context (carries the bridge and the owning terminal id).
 * @returns Returns the recent terminal output, or a note that the terminal is unavailable.
 */
export async function readTerminalOutput(context: AgentRunContext): Promise<string> {
  logger.trace('StudioTools', `Tool invoked: read_terminal_output (tab=${context.owningTabId})`);
  const result: unknown = await context.bridge.request(READ_TERMINAL_OUTPUT, {
    tabId: context.owningTabId,
  });
  const read: { available?: boolean; text?: string } = result ?? {};
  if (read.available !== true) {
    logger.debug('StudioTools', 'read_terminal_output: terminal unavailable');
    return 'The terminal is not available.';
  }
  return read.text ?? '';
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
  logger.trace(
    'StudioTools',
    `Tool invoked: write_terminal_input (tab=${context.owningTabId}, submit=${submit})`,
  );
  const result: unknown = await context.bridge.request(WRITE_TERMINAL_INPUT, {
    tabId: context.owningTabId,
    text,
    submit,
  });
  const write: { ok?: boolean; output?: string } = result ?? {};
  if (write.ok !== true) {
    logger.debug('StudioTools', 'write_terminal_input: terminal unavailable');
    return 'The terminal is not available.';
  }
  logger.info('StudioTools', `Sent input to terminal (tab=${context.owningTabId})`);
  return write.output ?? 'Sent to the terminal.';
}

/**
 * Runs an editor mutation through the edit-preview flow when the posture asks before edits: the
 * change is staged in the renderer (a diff opens in the document well for code targets), the user
 * decides (Yes / Yes-and-auto-accept / No), and the staged change is committed or discarded. Under
 * `auto-edits`/`auto-all` — or in chat mode, which never registers these tools — the direct apply
 * runs as before.
 * @param context The agent run context.
 * @param previewInput The preview capability input describing the operation.
 * @param direct Applies the mutation directly (the non-previewed path).
 * @returns Returns the model-facing result.
 */
async function previewedEdit(
  context: AgentRunContext,
  previewInput: Record<string, unknown>,
  direct: () => Promise<string>,
): Promise<string> {
  const rawOperation: unknown = previewInput['operation'];
  const operation: string = typeof rawOperation === 'string' ? rawOperation : 'edit';
  if (context.permissionPosture !== 'prompt' || context.mode !== 'agent') {
    logger.trace(
      'StudioTools',
      `Edit '${operation}' applied directly (posture=${context.permissionPosture}, mode=${context.mode})`,
    );
    return direct();
  }
  logger.trace('StudioTools', `Edit '${operation}' staged for preview`);
  const result: unknown = await context.bridge.request(PREVIEW_ACTIVE_DOCUMENT_EDIT, {
    ...previewInput,
    tabId: context.owningTabId,
  });
  const preview: {
    available?: boolean;
    previewId?: string;
    name?: string;
    summary?: string;
    detail?: string;
    diffShown?: boolean;
  } = result ?? {};
  if (preview.available !== true || typeof preview.previewId !== 'string') {
    // Anchor failures and missing documents report straight back so the model can recover.
    logger.debug('StudioTools', 'Edit preview unavailable (anchor failure or no document)');
    return preview.detail ?? 'No active document is open in the editor.';
  }
  const decision: 'yes' | 'no' = await context.requestEditDecision(
    preview.name ?? 'the active document',
    preview.summary ?? '',
    preview.diffShown === true,
  );
  logger.debug(
    'StudioTools',
    `User edit decision on '${preview.name ?? 'active document'}': ${decision}`,
  );
  if (decision === 'yes') {
    const committed: unknown = await context.bridge.request(COMMIT_EDIT_PREVIEW, {
      previewId: preview.previewId,
    });
    const commit: { ok?: boolean; detail?: string } = committed ?? {};
    logger.info(
      'StudioTools',
      `Committed previewed edit to '${preview.name ?? 'active document'}'`,
    );
    return (
      commit.detail ??
      (commit.ok === true ? 'The edit was applied.' : 'The editor is no longer available.')
    );
  }
  logger.info(
    'StudioTools',
    `User rejected previewed edit to '${preview.name ?? 'active document'}'`,
  );
  await context.bridge.request(CANCEL_EDIT_PREVIEW, { previewId: preview.previewId });
  return (
    'The user rejected this edit. Do not retry it as-is — ask what they would like instead, or ' +
    'adjust your approach.'
  );
}

/**
 * Reads the owning tab's editor document through the renderer bridge and renders the result for the
 * model.
 * @param context The agent run context (carries the bridge and the owning tab id).
 * @returns Returns the document text, or a note that no document is open.
 */
export async function readActiveDocument(context: AgentRunContext): Promise<string> {
  logger.trace('StudioTools', `Tool invoked: read_active_document (tab=${context.owningTabId})`);
  const result: unknown = await context.bridge.request(READ_ACTIVE_DOCUMENT, {
    tabId: context.owningTabId,
  });
  const read: { available?: boolean; text?: string } = result ?? {};
  if (read.available !== true) {
    logger.debug('StudioTools', 'read_active_document: no document open');
    return 'No active document is open in the editor.';
  }
  return read.text ?? '';
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
  logger.trace('StudioTools', `Tool invoked: replace_active_document (tab=${context.owningTabId})`);
  return previewedEdit(context, { operation: 'replace', text }, async (): Promise<string> => {
    const result: unknown = await context.bridge.request(REPLACE_ACTIVE_DOCUMENT, {
      text,
      tabId: context.owningTabId,
    });
    const replace: { ok?: boolean } = result ?? {};
    if (replace.ok === true) {
      logger.info('StudioTools', `Replaced active document (tab=${context.owningTabId})`);
      return 'The active document was updated.';
    }
    return 'There is no active document to update.';
  });
}

/**
 * Sets the owning tab's editor language (syntax) through the renderer bridge and renders the result.
 * @param context The agent run context (carries the bridge and the owning tab id).
 * @param language The target language (a Monaco language id, e.g. `csharp`, or a display name).
 * @returns Returns a short confirmation, or the reason the language was not set.
 */
export async function setActiveDocumentLanguage(
  context: AgentRunContext,
  language: string,
): Promise<string> {
  logger.trace('StudioTools', `Tool invoked: set_active_document_language (language=${language})`);
  const result: unknown = await context.bridge.request(SET_ACTIVE_DOCUMENT_LANGUAGE, {
    tabId: context.owningTabId,
    language,
  });
  const set: { ok?: boolean; detail?: string } = result ?? {};
  if (set.ok === true) {
    logger.info('StudioTools', `Set active document language to '${language}'`);
  } else {
    logger.debug('StudioTools', `set_active_document_language did not set '${language}'`);
  }
  return (
    set.detail ?? (set.ok === true ? 'The editor language was set.' : 'The language was not set.')
  );
}

/**
 * The shape the run capability returns from the renderer.
 */
interface RunToolResult {
  /**
   * Gets a value indicating whether the file was runnable and a run was started.
   */
  readonly ran?: boolean;

  /**
   * Gets the model-facing reason nothing ran (when `ran` is false).
   */
  readonly detail?: string;

  /**
   * Gets the shell command that was run.
   */
  readonly command?: string;

  /**
   * Gets the program's exit code, or null when it could not be determined (a non-POSIX shell, or a
   * run that did not finish in time).
   */
  readonly exitCode?: number | null;

  /**
   * Gets a value indicating whether the program exited successfully (exit code 0).
   */
  readonly success?: boolean;

  /**
   * Gets a value indicating whether the run timed out before finishing.
   */
  readonly timedOut?: boolean;

  /**
   * Gets the captured terminal output of the run.
   */
  readonly output?: string;
}

/**
 * Runs the owning tab's editor document in the code view's docked run terminal through the renderer
 * bridge, waits for it to finish, and renders the outcome for the model: the command, its exit
 * status, and the captured output. The run executes the live editor content (unsaved edits included),
 * exactly as the editor's Run action does, so the user sees it run in their terminal.
 * @param context The agent run context (carries the bridge and the owning tab id).
 * @param timeoutSeconds How long to wait for the program to finish; clamped to
 * `[1, {@link RUN_MAX_TIMEOUT_SECONDS}]` and defaulting to {@link RUN_DEFAULT_TIMEOUT_SECONDS}.
 * @returns Returns the rendered run outcome, or the reason nothing ran.
 */
export async function runActiveDocument(
  context: AgentRunContext,
  timeoutSeconds: number = RUN_DEFAULT_TIMEOUT_SECONDS,
): Promise<string> {
  const seconds: number = Math.min(
    RUN_MAX_TIMEOUT_SECONDS,
    Math.max(1, Math.floor(timeoutSeconds) || RUN_DEFAULT_TIMEOUT_SECONDS),
  );
  logger.trace(
    'StudioTools',
    `Tool invoked: run_active_document (tab=${context.owningTabId}, timeout=${seconds}s)`,
  );
  // Give the bridge a little longer than the renderer's own poll so the reply is never cut off first.
  const result: unknown = await context.bridge.request(
    RUN_ACTIVE_DOCUMENT,
    { tabId: context.owningTabId, timeoutSeconds: seconds },
    (seconds + 5) * 1000,
  );
  const run: RunToolResult = result ?? {};
  if (run.ran !== true) {
    logger.debug('StudioTools', 'run_active_document: nothing runnable in this view');
    return run.detail ?? 'There is no code document open to run in this view.';
  }
  logger.info(
    'StudioTools',
    `Ran active document: ${run.command ?? '(unknown command)'} (success=${run.success === true}, exitCode=${run.exitCode ?? 'unknown'}, timedOut=${run.timedOut === true})`,
  );
  const output: string = (run.output ?? '').trim();
  const status: string =
    run.success === true
      ? 'exited successfully (exit code 0)'
      : run.timedOut === true
        ? `did not finish within ${seconds}s and is still running`
        : typeof run.exitCode === 'number'
          ? `failed (exit code ${run.exitCode})`
          : 'finished with an unknown exit status';
  return [
    `Ran: ${run.command ?? '(unknown command)'}`,
    `Result: the program ${status}.`,
    '',
    'Output:',
    output.length > 0 ? output : '(no output)',
  ].join('\n');
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
  logger.trace(
    'StudioTools',
    `Tool invoked: edit_active_document (tab=${context.owningTabId}, replaceAll=${replaceAll})`,
  );
  return previewedEdit(
    context,
    { operation: 'edit', oldString, newString, replaceAll },
    async (): Promise<string> => {
      const result: unknown = await context.bridge.request(EDIT_ACTIVE_DOCUMENT, {
        tabId: context.owningTabId,
        oldString,
        newString,
        replaceAll,
      });
      const edit: { ok?: boolean; detail?: string } = result ?? {};
      if (edit.ok === true) {
        logger.info('StudioTools', `Applied edit to active document (tab=${context.owningTabId})`);
      }
      return (
        edit.detail ??
        (edit.ok === true ? 'The edit was applied.' : 'There is no active document to edit.')
      );
    },
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
  logger.trace(
    'StudioTools',
    `Tool invoked: insert_into_active_document (tab=${context.owningTabId}, placement=${placement})`,
  );
  return previewedEdit(
    context,
    { operation: 'insert', text, placement, ...(anchor === undefined ? {} : { anchor }) },
    async (): Promise<string> => {
      const result: unknown = await context.bridge.request(INSERT_ACTIVE_DOCUMENT, {
        tabId: context.owningTabId,
        text,
        placement,
        anchor,
      });
      const insert: { ok?: boolean; detail?: string } = result ?? {};
      if (insert.ok === true) {
        logger.info(
          'StudioTools',
          `Inserted text into active document (tab=${context.owningTabId})`,
        );
      }
      return (
        insert.detail ??
        (insert.ok === true
          ? 'The text was inserted.'
          : 'There is no active document to insert into.')
      );
    },
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
  logger.trace(
    'StudioTools',
    `Binary read invoked: ${capability}${range ? ` (offset=${range.offset}, length=${range.length})` : ''}`,
  );
  const result: unknown = await context.bridge.request(capability, {
    tabId: context.owningTabId,
    ...range,
  });
  const read: { available?: boolean; text?: string } = result ?? {};
  if (read.available !== true) {
    logger.debug('StudioTools', `${capability}: no binary document open`);
    return 'No binary document is open in this view.';
  }
  return read.text ?? '';
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
  logger.trace('StudioTools', `Tool invoked: patch_binary_bytes (offset=${offset})`);
  const result: unknown = await context.bridge.request(PATCH_BINARY_BYTES, {
    tabId: context.owningTabId,
    offset,
    bytes,
  });
  const patch: { ok?: boolean; text?: string } = result ?? {};
  if (patch.ok === true) {
    logger.info('StudioTools', `Patched binary bytes at offset ${offset}`);
  } else {
    logger.debug('StudioTools', `patch_binary_bytes rejected at offset ${offset}`);
  }
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
  logger.trace('StudioTools', `Tool invoked: insert_binary_bytes (offset=${offset})`);
  const result: unknown = await context.bridge.request(INSERT_BINARY_BYTES, {
    tabId: context.owningTabId,
    offset,
    bytes,
  });
  const insert: { ok?: boolean; text?: string } = result ?? {};
  if (insert.ok === true) {
    logger.info('StudioTools', `Inserted binary bytes at offset ${offset}`);
  } else {
    logger.debug('StudioTools', `insert_binary_bytes rejected at offset ${offset}`);
  }
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
  logger.trace(
    'StudioTools',
    `Tool invoked: delete_binary_bytes (offset=${offset}, length=${length})`,
  );
  const result: unknown = await context.bridge.request(DELETE_BINARY_BYTES, {
    tabId: context.owningTabId,
    offset,
    length,
  });
  const del: { ok?: boolean; text?: string } = result ?? {};
  if (del.ok === true) {
    logger.info('StudioTools', `Deleted ${length} binary byte(s) at offset ${offset}`);
  } else {
    logger.debug('StudioTools', `delete_binary_bytes rejected at offset ${offset}`);
  }
  return del.text ?? (del.ok === true ? 'The bytes were deleted.' : 'The bytes were not deleted.');
}

/**
 * Assembles assembly text and writes it at an offset in the owning binary document through the renderer
 * bridge, and renders the result for the model. The file length is preserved: shorter output is
 * NOP-padded and longer output is rejected.
 * @param context The agent run context.
 * @param offset The offset to write the assembled bytes at.
 * @param assembly The assembly text (one or more instructions, e.g. `mov eax, 1; ret`).
 * @param length The number of bytes the write should occupy (the replaced range); optional, defaulting
 * to the assembled length.
 * @returns Returns a confirmation with the bytes written and their disassembly, or the reason the write
 * was rejected.
 */
export async function writeBinaryAssembly(
  context: AgentRunContext,
  offset: number,
  assembly: string,
  length?: number,
): Promise<string> {
  logger.trace('StudioTools', `Tool invoked: write_binary_assembly (offset=${offset})`);
  const result: unknown = await context.bridge.request(WRITE_BINARY_ASSEMBLY, {
    tabId: context.owningTabId,
    offset,
    assembly,
    ...(length === undefined ? {} : { length }),
  });
  const write: { ok?: boolean; text?: string } = result ?? {};
  if (write.ok === true) {
    logger.info('StudioTools', `Wrote assembly at offset ${offset}`);
  } else {
    logger.debug('StudioTools', `write_binary_assembly rejected at offset ${offset}`);
  }
  return (
    write.text ??
    (write.ok === true ? 'The assembly was written.' : 'The assembly was not written.')
  );
}

/**
 * Appended to the system prompt for an API-surface run, so the model knows it is docked to the API
 * Explorer and that setting a request up is something it does rather than describes.
 */
export const API_PROMPT_APPENDIX: string = [
  'You are running inside ONIXLabs Studio, docked to an API Explorer tab, and you can act on its',
  'collections directly:',
  `- "${LIST_API_REQUESTS}" lists the collections, saved requests and environments already there.`,
  `- "${CREATE_API_REQUEST}" saves a new request and opens it in the API well for the user to see.`,
  `- "${UPDATE_API_REQUEST}" changes a saved request; anything you do not name is left alone.`,
  `- "${SEND_API_REQUEST}" sends a saved request and returns its status, headers and body.`,
  `- "${SET_API_VARIABLE}" sets a variable in the active environment.`,
  'When the user asks about an API, set it up rather than only explaining it: list what is there,',
  'then create the requests you are describing so they can press Send. Write what an endpoint does,',
  "what it expects and what it returns into the request's description, so the explanation lives with",
  'the request instead of only in this conversation.',
  'Reference environment values as {{name}} rather than hard-coding a host or a token into a URL —',
  'that is what makes a collection work against more than one environment. Put the base URL in a',
  'variable when you find yourself repeating it.',
  'Sending is a real call to a real service. Send when the user asks you to, or when you need the',
  'response to answer them; do not send repeatedly to explore, and never send a request that changes',
  'state (POST, PUT, PATCH, DELETE) without the user asking for it.',
].join('\n');

/**
 * Lists the API Explorer's collections, saved requests and environments through the renderer bridge.
 * @param context The agent run context (carries the bridge).
 * @returns Returns the tree as JSON, or a note that no API Explorer tab is open.
 */
export async function listApiRequests(context: AgentRunContext): Promise<string> {
  logger.trace('StudioTools', 'Tool invoked: list_api_requests');
  const result: unknown = await context.bridge.request(LIST_API_REQUESTS, {});
  const read: { available?: boolean; collections?: unknown[]; environments?: unknown[] } =
    result ?? {};
  if (read.available !== true) {
    return 'No API Explorer tab is open, so there are no collections to read.';
  }
  const collections: unknown[] = read.collections ?? [];
  logger.debug('StudioTools', `list_api_requests: ${collections.length} collection(s)`);
  return [
    `Collections:\n${JSON.stringify(collections, null, 2)}`,
    `Environments:\n${JSON.stringify(read.environments ?? [], null, 2)}`,
  ].join('\n\n');
}

/**
 * Creates a saved request through the renderer bridge and renders the outcome.
 * @param context The agent run context (carries the bridge).
 * @param request The request to create.
 * @returns Returns a confirmation, or the reason the request was refused.
 */
export async function createApiRequest(
  context: AgentRunContext,
  request: Record<string, unknown>,
): Promise<string> {
  logger.trace('StudioTools', `Tool invoked: create_api_request (${String(request['method'])})`);
  const result: unknown = await context.bridge.request(CREATE_API_REQUEST, { request });
  const write: { ok?: boolean; error?: string; id?: string; name?: string } = result ?? {};
  if (write.ok !== true) {
    logger.warn('StudioTools', `create_api_request refused: ${write.error ?? 'unknown reason'}`);
    return write.error ?? 'The request could not be created.';
  }
  logger.info('StudioTools', `Created API request ${write.id ?? ''}`);
  return `Created "${write.name ?? 'request'}" (id ${write.id ?? ''}) and opened it in the API well.`;
}

/**
 * Applies changes to a saved request through the renderer bridge and renders the outcome.
 * @param context The agent run context (carries the bridge).
 * @param id The identifier of the request to change.
 * @param changes The fields to change.
 * @returns Returns a confirmation, or the reason the change was refused.
 */
export async function updateApiRequest(
  context: AgentRunContext,
  id: string,
  changes: Record<string, unknown>,
): Promise<string> {
  logger.trace('StudioTools', `Tool invoked: update_api_request (${id})`);
  const result: unknown = await context.bridge.request(UPDATE_API_REQUEST, { id, changes });
  const write: { ok?: boolean; error?: string } = result ?? {};
  if (write.ok !== true) {
    return write.error ?? 'The request could not be updated.';
  }
  logger.info('StudioTools', `Updated API request ${id}`);
  return `Updated request ${id}.`;
}

/**
 * Sends a saved request through the renderer bridge and renders its outcome for the model. The body
 * is truncated: a large response would otherwise consume the context window the model needs to reason
 * about it.
 * @param context The agent run context (carries the bridge).
 * @param id The identifier of the request to send.
 * @returns Returns the rendered outcome.
 */
export async function sendApiRequest(context: AgentRunContext, id: string): Promise<string> {
  logger.trace('StudioTools', `Tool invoked: send_api_request (${id})`);
  const result: unknown = await context.bridge.request(SEND_API_REQUEST, { id });
  const sent: {
    ok?: boolean;
    error?: string;
    status?: number;
    statusText?: string;
    durationMs?: number;
    headers?: Record<string, string>;
    body?: string;
    truncated?: boolean;
  } = result ?? {};
  if (sent.ok !== true) {
    logger.debug('StudioTools', `send_api_request failed: ${sent.error ?? 'unknown reason'}`);
    return sent.error ?? 'The request could not be sent.';
  }
  logger.info('StudioTools', `Sent API request ${id}: ${sent.status ?? 0}`);
  return [
    `${sent.status ?? 0} ${sent.statusText ?? ''} in ${Math.round(sent.durationMs ?? 0)} ms`,
    `Headers:\n${JSON.stringify(sent.headers ?? {}, null, 2)}`,
    `Body${sent.truncated === true ? ' (truncated)' : ''}:\n${sent.body ?? ''}`,
  ].join('\n\n');
}

/**
 * Sets a variable in the API Explorer's active environment through the renderer bridge.
 * @param context The agent run context (carries the bridge).
 * @param name The variable name.
 * @param value The variable value.
 * @returns Returns a confirmation, or the reason the variable was not set.
 */
export async function setApiVariable(
  context: AgentRunContext,
  name: string,
  value: string,
): Promise<string> {
  logger.trace('StudioTools', `Tool invoked: set_api_variable (${name})`);
  const result: unknown = await context.bridge.request(SET_API_VARIABLE, { name, value });
  const write: { ok?: boolean; error?: string; environment?: string } = result ?? {};
  if (write.ok !== true) {
    return write.error ?? 'The variable could not be set.';
  }
  logger.info('StudioTools', `Set API variable ${name}`);
  return `Set {{${name}}} in the "${write.environment ?? 'active'}" environment.`;
}
