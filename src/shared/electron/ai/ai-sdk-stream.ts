import type { ToolSet } from 'ai';
import {
  ASK_USER,
  isToolViewSurface,
  LIST_LOG_SESSIONS,
  QUERY_LOGS,
  READ_SYSTEM_METRICS,
  SET_LOG_LEVEL,
  LIST_LOCAL_MODELS,
  SEARCH_MODEL_CATALOG,
  READ_MACHINE_FACTS,
  DOWNLOAD_MODEL,
  DELETE_MODEL,
  LIST_PROMPT_PROFILES,
  SAVE_PROMPT_PROFILE,
  DELETE_PROMPT_PROFILE,
  LIST_SKILLS,
  READ_SKILL,
  LIST_SKILL_TAGS,
  SAVE_SKILL,
  DELETE_SKILL,
  LIST_PLUGINS,
  READ_WORKSPACE_LANGUAGES,
  INSTALL_PLUGIN,
  UNINSTALL_PLUGIN,
  LIST_CONTAINERS,
  LIST_CONTAINER_IMAGES,
  LIST_CONTAINER_VOLUMES,
  READ_CONTAINER_LOGS,
  CONTROL_CONTAINER,
  REMOVE_CONTAINER,
  PULL_IMAGE,
  REMOVE_IMAGE,
  REMOVE_VOLUME,
  RUN_CONTAINER,
  PROPOSE_WORKSPACE,
  DELETE_BINARY_BYTES,
  EDIT_ACTIVE_DOCUMENT,
  INSERT_ACTIVE_DOCUMENT,
  INSERT_BINARY_BYTES,
  PATCH_BINARY_BYTES,
  READ_ACTIVE_DOCUMENT,
  READ_BINARY_BYTES,
  READ_BINARY_DISASSEMBLY,
  CREATE_API_REQUEST,
  DELETE_RUN_CONFIGURATIONS,
  LIST_API_REQUESTS,
  LIST_RUN_CONFIGURATIONS,
  SAVE_RUN_CONFIGURATIONS,
  SEND_API_REQUEST,
  SET_API_VARIABLE,
  UPDATE_API_REQUEST,
  OPEN_DOCUMENT,
  READ_DOCUMENT,
  EDIT_DOCUMENT,
  REPLACE_DOCUMENT,
  OPEN_FILE,
  LIST_OPEN_DOCUMENTS,
  OPEN_DIFF,
  READ_SOURCE_CONTROL_STATUS,
  LIST_TERMINALS,
  CREATE_FILE,
  CREATE_FOLDER,
  RENAME_PATH,
  DELETE_PATH,
  REVEAL_IN_EXPLORER,
  OPEN_TERMINAL,
  SAVE_DOCUMENT,
  READ_BINARY_OVERVIEW,
  READ_BINARY_SELECTION,
  READ_TERMINAL_OUTPUT,
  REPLACE_ACTIVE_DOCUMENT,
  RUN_ACTIVE_DOCUMENT,
  SET_ACTIVE_DOCUMENT_LANGUAGE,
  WRITE_BINARY_ASSEMBLY,
  WRITE_TERMINAL_INPUT,
  type AgentSurface,
  type AiInputChoice,
  type AiToolPolicy,
  type InsertPlacement,
} from '@shared/api/ai-types';
import type { AgentRunContext } from './agent-provider';
import type { RunContainerRequest } from '@shared/api/container-types';
import {
  ASK_USER_DESCRIPTION,
  PROPOSE_WORKSPACE_DESCRIPTION,
  proposeWorkspace,
  ASK_USER_PROMPT_APPENDIX,
  API_PROMPT_APPENDIX,
  BINARY_PROMPT_APPENDIX,
  CLARIFYING_QUESTION_APPENDIX,
  createApiRequest,
  deleteRunConfigurations,
  listApiRequests,
  listRunConfigurations,
  saveRunConfigurations,
  sendApiRequest,
  setApiVariable,
  updateApiRequest,
  PROJECT_PROMPT_APPENDIX,
  RUN_CONFIGURATION_PROMPT_APPENDIX,
  STUDIO_PROMPT_APPENDIX,
  TERMINAL_PROMPT_APPENDIX,
  WORKBENCH_PROMPT_APPENDIX,
  WORKSPACE_PROMPT_APPENDIX,
  openDocument,
  readDocument,
  editDocument,
  replaceDocument,
  openFile,
  openDiff,
  listOpenDocuments,
  listTerminals,
  createFile,
  createFolder,
  renamePath,
  deletePath,
  revealInExplorer,
  readSourceControlStatus,
  openTerminal,
  saveDocument,
  askUser,
  deleteBinaryBytes,
  editActiveDocument,
  insertBinaryBytes,
  insertIntoActiveDocument,
  patchBinaryBytes,
  readActiveDocument,
  readBinaryBytes,
  readBinaryDisassembly,
  readBinaryOverview,
  readBinarySelection,
  readTerminalOutput,
  replaceActiveDocument,
  runActiveDocument,
  setActiveDocumentLanguage,
  writeBinaryAssembly,
  writeTerminalInput,
  READ_ONLY_APPENDIX,
} from './studio-tools';
import { skillsAppendix, withSystemPromptExtra } from './prompt-layers';
import { createHostingTools, hostingPromptAppendix } from './hosting-tools';
import { createSkillTools } from './skill-tools';
import {
  listLogSessions,
  MONITOR_PROMPT_APPENDIX,
  queryLogs,
  readSystemMetrics,
  setLogLevel,
} from './monitor-tools';
import {
  AI_MANAGER_PROMPT_APPENDIX,
  deleteModel,
  deletePromptProfile,
  deleteSkill,
  downloadModel,
  listLocalModels,
  listPromptProfiles,
  listSkills,
  listSkillTags,
  readMachineFacts,
  readSkill,
  savePromptProfile,
  saveSkill,
  searchModelCatalog,
} from './ai-manager-tools';
import {
  installPlugin,
  listPlugins,
  PLUGIN_MANAGER_PROMPT_APPENDIX,
  readWorkspaceLanguages,
  uninstallPlugin,
} from './plugin-manager-tools';
import {
  CONTAINERS_PROMPT_APPENDIX,
  controlContainer,
  listContainerImages,
  listContainers,
  listContainerVolumes,
  pullImage,
  readContainerLogs,
  removeContainer,
  removeImage,
  refuseUnconfinedMounts,
  removeVolume,
  runContainer,
} from './containers-tools';
import { describeRunRequest } from '@shared/api/container-run-request';
import { summarizeToolInput } from './tool-format';
import { coarseGrantSource } from './tool-policy';
import { logger } from '../logger';

/**
 * The maximum number of steps (model turns plus tool round-trips) a single run may take before the
 * Vercel AI SDK stops the agentic loop.
 */
export const MAX_STEPS: number = 16;

/**
 * A loosely-typed part from the Vercel AI SDK's `fullStream`, covering the fields read here. The SDK's
 * own part type is a broad union; this captures just what the event mapping needs.
 */
export interface StreamPart {
  /**
   * Gets the part discriminator (`text-delta`, `reasoning-delta`, `tool-call`, `tool-result`,
   * `error`, …).
   */
  readonly type: string;
  readonly text?: string;
  readonly delta?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly errorText?: string;

  /**
   * Gets the cumulative token usage carried by a `finish` part. Fields are optional because a model
   * back-end may not report every count.
   */
  readonly totalUsage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };

  /**
   * Gets the error carried by an `error` part. The SDK surfaces request/stream failures here rather
   * than throwing, so this must be inspected — see {@link consumeAgentStream}.
   */
  readonly error?: unknown;
}

/**
 * Renders a human-readable reason from an error thrown during a run, or carried by a stream `error`
 * part. Pulls a message from AI SDK call errors, Error instances, and plain values, falling back to a
 * generic note so the user is never left with nothing.
 * @param error The error value.
 * @returns Returns a non-empty, displayable message.
 */
export function describeRunError(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (error !== null && typeof error === 'object') {
    const record: { message?: unknown } = error;
    if (typeof record.message === 'string' && record.message.length > 0) {
      return record.message;
    }
  }
  return 'The run failed with an unspecified error.';
}

/**
 * Builds the ask-user tool every AI-SDK-backed provider exposes on every surface, bridged to the
 * renderer through the run context's input round-trip. The `ai` and `zod` packages are imported
 * dynamically to match the providers' own dynamic-import (ESM-compatibility) convention.
 * @param context The run context the tool acts through.
 * @returns Returns the tool set entry, ready to merge into a surface's tool set.
 */
export async function createAskUserTool(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    [ASK_USER]: tool({
      description: ASK_USER_DESCRIPTION,
      inputSchema: z.object({
        question: z.string().min(1).describe('The question to ask the user.'),
        choices: z
          .array(
            z.object({
              label: z
                .string()
                .min(1)
                .describe('The short answer label; sent back verbatim as the answer when picked.'),
              description: z
                .string()
                .optional()
                .describe(
                  'An explanation of this choice: what picking it means, its trade-offs, and "(recommended)" when it is your recommendation.',
                ),
            }),
          )
          .optional()
          .describe(
            'Suggested answers the user can pick from (they may always answer with their own text instead). Put a recommended choice first. Omit for a free-form question.',
          ),
        multiple: z
          .boolean()
          .optional()
          .describe(
            'True when the user may pick several choices at once (the choices are not mutually exclusive); the answer is then the picked labels joined with ", ". Omit when exactly one choice applies.',
          ),
      }),
      execute: (args: {
        question: string;
        choices?: AiInputChoice[];
        multiple?: boolean;
      }): Promise<string> =>
        askUser(
          context,
          args.question,
          args.choices ?? [],
          args.multiple === true ? 'multiple' : 'single',
        ),
    }),
  };
}

/**
 * Wraps a mutating tool's executor in the shared permission round-trip, applying the run's posture
 * exactly as the Claude path's `canUseTool` does for the same tools: `auto-all` runs straight
 * through; every other posture asks the user first (these tools are not in the auto-edits set), and
 * a refusal is reported back to the model instead of running the tool. This closes the gap where the
 * AI-SDK providers executed tools with no gating hook at all.
 * @param context The run context (carries the posture and the permission round-trip).
 * @param name The tool name shown on the permission prompt.
 * @param execute The gated executor.
 * @param describe Renders the input for the prompt and the audit record; defaults to the common
 * one-line summary. A tool whose input the summary cannot do justice to — a container run, whose
 * mounts are the whole question — supplies its own.
 * @returns Returns the wrapped executor.
 */
function gated<TArgs>(
  context: AgentRunContext,
  name: string,
  execute: (args: TArgs) => Promise<string>,
  describe: (args: TArgs) => string = summarizeToolInput,
): (args: TArgs) => Promise<string> {
  return async (args: TArgs): Promise<string> => {
    // Per-tool default policy (#309), consulted ahead of the posture: `deny` refuses, `allow` runs
    // without prompting, and an unset tool (or `ask`) falls through to the posture/prompt below.
    const detail: string = describe(args);
    const policy: AiToolPolicy = context.toolPolicies[name] ?? 'ask';
    if (policy === 'deny') {
      logger.debug('ai-sdk-stream.gated', `Tool "${name}" refused by Deny policy`);
      return `The ${name} tool is set to Deny in your agent settings.`;
    }
    if (policy !== 'allow' && context.permissionPosture !== 'auto-all') {
      const granted: boolean = await context.requestPermission(name, detail);
      if (!granted) {
        logger.debug('ai-sdk-stream.gated', `User declined tool "${name}"`);
        return 'The user declined to run this tool.';
      }
    }
    // This is the execution point — audit the action here (#311), matching the Claude path's
    // `PostToolUse` audit. The AI-SDK providers have no safety classifier, so every `gated` tool
    // reaches this line, and denials returned above. Source is the coarse policy/posture value (these
    // tools are all mutating and none is a file-edit tool, so `auto-edits` never applies).
    context.recordAudit(name, detail, coarseGrantSource(policy, context.permissionPosture, false));
    return execute(args);
  };
}

/**
 * The surfaces that stand in a workspace and may therefore author its run configurations: an editor
 * tab (its document belongs to the workspace), the standalone agent tab, and the workspace tab itself.
 */
const WORKSPACE_SCOPED_SURFACES: readonly AgentSurface[] = ['editor', 'project', 'workspace'];

/**
 * Builds the one read-only document tool, which the editor surface carries alongside its edit tools and
 * the workspace surface carries alone (#713): seeing what the user is looking at is cheap and harmless
 * wherever there is a well; it is editing "whichever document is focused" that a workspace conversation
 * must not be offered.
 * @param context The run context the tool acts through.
 * @returns Returns the tool set holding the read tool.
 */
export async function createReadActiveDocumentTool(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    [READ_ACTIVE_DOCUMENT]: tool({
      description: "Read the active editor document's full text.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => readActiveDocument(context),
    }),
  };
}

/**
 * Builds the workspace surface's tools (#713): a well to look at but no document of its own. The read
 * tool lets the model see what the user is looking at; the listing, the diff and the source-control
 * status let it see the workspace as the user does; none of the edit tools, which would act on
 * whatever happened to be focused. All read-only in effect — opening a diff shows something, it
 * changes nothing — so none is gated.
 * @param context The run context the tools act through.
 * @returns Returns the tool set.
 */
export async function createWorkspaceTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    ...(await createReadActiveDocumentTool(context)),
    [LIST_OPEN_DOCUMENTS]: tool({
      description:
        "List the documents open in the workspace's editor well: each one's path, language, whether it is unsaved, and which one the user is looking at.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => listOpenDocuments(context),
    }),
    [OPEN_DIFF]: tool({
      description:
        "Open a changed file's diff — working tree against HEAD — in the user's editor well, so they can review a change where it lives. Only a file the repository reports as changed has a diff to show. Prefer this to pasting a diff into the conversation.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe('The changed file, as an absolute path or relative to the workspace root.'),
      }),
      execute: (args: { path: string }): Promise<string> => openDiff(context, args.path),
    }),
    [READ_SOURCE_CONTROL_STATUS]: tool({
      description:
        "Read the workspace's version-control state as Studio shows it: the branch and how it tracks its upstream, and the staged, unstaged and conflicted files. Worktree-aware. Use it instead of running git yourself when you only need the picture.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => readSourceControlStatus(context),
    }),
    ...(await createWorkspaceTerminalTools(context)),
    ...(await createWorkspaceTreeTools(context)),
  };
}

/**
 * Builds the workspace surface's tree tools (#713 phase 4): the Explorer's own operations, offered to
 * the agent so the Explorer reflects what it does and, for a harness with no file tools, so it can
 * make files at all. The mutations are gated like every other mutating Studio tool and confined to
 * the workspace and the run's allowed write paths before the renderer is asked; a chat turn gets
 * only the reveal, which changes nothing.
 * @param context The run context the tools act through.
 * @returns Returns the tool set.
 */
export async function createWorkspaceTreeTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const pathOf: string = 'An absolute path, or one relative to the workspace root.';
  const reveal: ToolSet = {
    [REVEAL_IN_EXPLORER]: tool({
      description:
        'Expand the Explorer to a file or folder and select it, so the user is looking at what you are talking about. It only reveals — it does not open the file.',
      inputSchema: z.object({ path: z.string().min(1).describe(pathOf) }),
      execute: (args: { path: string }): Promise<string> => revealInExplorer(context, args.path),
    }),
  };
  if (context.mode === 'chat') {
    return reveal;
  }
  return {
    ...reveal,
    [CREATE_FILE]: tool({
      description:
        "Create a file in the workspace, optionally with content, and open it in the user's editor. The Explorer shows it at once. Fails if the file exists; use your edit tools to change an existing file.",
      inputSchema: z.object({
        path: z.string().min(1).describe(pathOf),
        content: z
          .string()
          .optional()
          .describe('The full content to write. Omit for an empty file.'),
      }),
      execute: gated(
        context,
        CREATE_FILE,
        (args: { path: string; content?: string }): Promise<string> =>
          createFile(context, args.path, args.content),
      ),
    }),
    [CREATE_FOLDER]: tool({
      description: 'Create a folder in the workspace. The Explorer shows it at once.',
      inputSchema: z.object({ path: z.string().min(1).describe(pathOf) }),
      execute: gated(context, CREATE_FOLDER, (args: { path: string }): Promise<string> =>
        createFolder(context, args.path),
      ),
    }),
    [RENAME_PATH]: tool({
      description:
        'Rename a file or folder in place. Give the new name only, not a path; to move an entry use your own file tools.',
      inputSchema: z.object({
        path: z.string().min(1).describe(pathOf),
        name: z.string().min(1).describe('The new name: a single path segment.'),
      }),
      execute: gated(
        context,
        RENAME_PATH,
        (args: { path: string; name: string }): Promise<string> =>
          renamePath(context, args.path, args.name),
      ),
    }),
    [DELETE_PATH]: tool({
      description:
        "Delete a file or folder, to the operating system's trash where the platform allows it. The result says whether it went to the trash or was removed permanently.",
      inputSchema: z.object({ path: z.string().min(1).describe(pathOf) }),
      execute: gated(context, DELETE_PATH, (args: { path: string }): Promise<string> =>
        deletePath(context, args.path),
      ),
    }),
  };
}

/**
 * Builds the workspace surface's terminal tools (#713): terminals as addressable things. A workspace
 * agent has no owning terminal, so unlike the terminal surface's tools these take the id of the one
 * to drive — the id `open_terminal` returned, or one `list_terminals` reported. `open_terminal` is
 * re-declared here so that on this surface it lands in the workspace's own panel rather than a new
 * tab; it overrides the workbench declaration by name. Writing stays a gated execution, as it is on
 * the terminal surface; a chat-mode run gets only the listing and the read.
 * @param context The run context the tools act through.
 * @returns Returns the tool set.
 */
export async function createWorkspaceTerminalTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const idDescription: string =
    'The id of the terminal, as returned by open_terminal or listed by list_terminals.';
  const readTools: ToolSet = {
    [LIST_TERMINALS]: tool({
      description:
        "List the terminals open in the workspace's terminal panel, with the id each one is driven by.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => listTerminals(context),
    }),
    [READ_TERMINAL_OUTPUT]: tool({
      description: 'Read the recent output currently shown in one of the workspace terminals.',
      inputSchema: z.object({ terminalId: z.string().min(1).describe(idDescription) }),
      execute: (args: { terminalId: string }): Promise<string> =>
        readTerminalOutput(context, args.terminalId),
    }),
  };
  if (context.mode === 'chat') {
    return readTools;
  }
  return {
    ...readTools,
    [OPEN_TERMINAL]: tool({
      description:
        "Open a new terminal in the workspace's terminal panel, rooted at the workspace, where the user can watch it. Returns the id to drive it with. Use this when the user should see a command run rather than a hidden shell.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => openTerminal(context, true),
    }),
    [WRITE_TERMINAL_INPUT]: tool({
      description:
        'Type text into one of the workspace terminals, running it as a command by default, and return the resulting output.',
      inputSchema: z.object({
        terminalId: z.string().min(1).describe(idDescription),
        text: z.string().describe('The text to type into the terminal.'),
        submit: z
          .boolean()
          .optional()
          .describe('Whether to run the text as a command (append a newline). Defaults to true.'),
      }),
      execute: gated(
        context,
        WRITE_TERMINAL_INPUT,
        (args: { terminalId: string; text: string; submit?: boolean }): Promise<string> =>
          writeTerminalInput(context, args.text, args.submit ?? true, args.terminalId),
      ),
    }),
  };
}

/**
 * Builds the in-app editor tools every AI-SDK-backed provider exposes, bridged to the renderer through
 * the run context. A chat-mode (read-only) run carries only the read tool, matching the Claude path;
 * the mutating editor tools are auto-allowed in agent mode because the change is visible and undoable
 * in the editor. The `ai` and `zod` packages are imported dynamically to match the providers' own
 * dynamic-import (ESM-compatibility) convention.
 * @param context The run context the tools act through.
 * @returns Returns the tool set keyed by tool name, ready to pass to `streamText`.
 */
export async function createStudioTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const readTool: ToolSet = await createReadActiveDocumentTool(context);
  if (context.mode === 'chat') {
    return readTool;
  }
  return {
    ...readTool,
    [EDIT_ACTIVE_DOCUMENT]: tool({
      description:
        'Replace one exact occurrence of a string in the active editor document (or every occurrence with replace_all). The old string must match uniquely — include surrounding context to disambiguate. Replace with an empty string to delete.',
      inputSchema: z.object({
        old_string: z
          .string()
          .min(1)
          .describe('The exact text to replace; must match the document verbatim.'),
        new_string: z.string().describe('The replacement text (empty deletes the matched text).'),
        replace_all: z
          .boolean()
          .optional()
          .describe(
            'Whether to replace every occurrence instead of requiring a unique match. Defaults to false.',
          ),
      }),
      execute: (args: {
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      }): Promise<string> =>
        editActiveDocument(context, args.old_string, args.new_string, args.replace_all ?? false),
    }),
    [INSERT_ACTIVE_DOCUMENT]: tool({
      description:
        "Insert text into the active editor document: before or after an anchor string (which must match uniquely), or at the document's start or end.",
      inputSchema: z.object({
        text: z.string().min(1).describe('The text to insert.'),
        placement: z
          .enum(['before', 'after', 'start', 'end'])
          .describe('Where to insert: relative to the anchor, or at a document edge.'),
        anchor: z
          .string()
          .optional()
          .describe(
            'The exact anchor text for before/after placements; must match the document verbatim and uniquely.',
          ),
      }),
      execute: (args: { text: string; placement: string; anchor?: string }): Promise<string> =>
        insertIntoActiveDocument(
          context,
          args.text,
          args.placement as InsertPlacement,
          args.anchor,
        ),
    }),
    [REPLACE_ACTIVE_DOCUMENT]: tool({
      description:
        "Replace the active editor document's entire text. Prefer edit_active_document / insert_into_active_document for targeted changes.",
      inputSchema: z.object({ text: z.string().describe('The new full text of the document.') }),
      execute: (args: { text: string }): Promise<string> =>
        replaceActiveDocument(context, args.text),
    }),
    [SET_ACTIVE_DOCUMENT_LANGUAGE]: tool({
      description:
        "Set the active editor document's language (syntax highlighting), e.g. when you write code in a language the editor is not yet set to. Use a Monaco language id such as csharp, typescript, python, rust, or go.",
      inputSchema: z.object({
        language: z
          .string()
          .min(1)
          .describe('The target language: a Monaco language id (e.g. csharp) or its display name.'),
      }),
      execute: (args: { language: string }): Promise<string> =>
        setActiveDocumentLanguage(context, args.language),
    }),
    [RUN_ACTIVE_DOCUMENT]: tool({
      description:
        "Run this tab's file in the code view's terminal and return its output and exit status, so you can check whether it ran successfully. Runs the live editor content (put your changes in the editor first with the edit tools). Supports javascript, typescript, python, csharp, java, kotlin, rust, go, and shell; other languages report that they cannot be run. The user sees it run in their terminal.",
      inputSchema: z.object({
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(300)
          .optional()
          .describe(
            'How long to wait for the program to finish before returning with whatever output it has (default 60, max 300).',
          ),
      }),
      // Running code is an execution, so it flows through the permission gate (prompting unless the
      // posture auto-allows everything), matching the Claude path where it is not auto-allowed.
      execute: gated(
        context,
        RUN_ACTIVE_DOCUMENT,
        (args: { timeout_seconds?: number }): Promise<string> =>
          runActiveDocument(context, args.timeout_seconds ?? 60),
      ),
    }),
  };
}

/**
 * Builds the terminal-surface tools every AI-SDK-backed provider exposes for a terminal-scoped run,
 * bridged to the renderer through the run context. The agent acts only through these two tools: it
 * reads the terminal's recent output and types input/commands into it. A chat-mode run carries only
 * the read tool, and the write tool asks through the permission round-trip unless the posture
 * auto-allows everything — the same rules the Claude path enforces. The `ai` and `zod` packages are
 * imported dynamically to match the providers' own dynamic-import (ESM-compatibility) convention.
 * @param context The run context the tools act through.
 * @returns Returns the tool set keyed by tool name, ready to pass to `streamText`.
 */
export async function createTerminalTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const readTool: ToolSet = {
    [READ_TERMINAL_OUTPUT]: tool({
      description: 'Read the recent output currently shown in the terminal.',
      inputSchema: z.object({}),
      execute: (): Promise<string> => readTerminalOutput(context),
    }),
  };
  if (context.mode === 'chat') {
    return readTool;
  }
  return {
    ...readTool,
    [WRITE_TERMINAL_INPUT]: tool({
      description:
        'Type text into the terminal, running it as a command by default, and return the resulting output.',
      inputSchema: z.object({
        text: z.string().describe('The text to type into the terminal.'),
        submit: z
          .boolean()
          .optional()
          .describe('Whether to run the text as a command (append a newline). Defaults to true.'),
      }),
      execute: gated(
        context,
        WRITE_TERMINAL_INPUT,
        (args: { text: string; submit?: boolean }): Promise<string> =>
          writeTerminalInput(context, args.text, args.submit ?? true),
      ),
    }),
  };
}

/**
 * Builds the workbench tools every AI-SDK-backed provider exposes on **every** surface: opening a new
 * document tab and filling it, offering to save it, and opening a terminal. They are not surface-bound
 * because opening a top-level tab is an application action rather than something the agent's own
 * surface does. Withheld in read-only chat mode, which creates nothing.
 * @param context The run context the tools act through.
 * @returns Returns the workbench tool set, or an empty set in chat mode.
 */
export async function createWorkbenchTools(context: AgentRunContext): Promise<ToolSet> {
  if (context.mode === 'chat') {
    return {};
  }
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    [OPEN_DOCUMENT]: tool({
      description:
        'Open a new tab containing a document you have written — a report, a design note, a draft file — and show it to the user. The document opens UNSAVED and touches nothing on disk, so opening one is free and reversible. Use it instead of pasting anything long into the conversation. To change it later, revise it with edit_document or replace_document rather than opening another. Returns the id those tools and save_document take.',
      inputSchema: z.object({
        format: z
          .enum(['markdown', 'code'])
          .describe('markdown for prose, code for anything else.'),
        title: z
          .string()
          .min(1)
          .describe("The tab's title, and the name suggested in the save dialog."),
        content: z.string().describe('The full content of the document.'),
        language: z
          .string()
          .optional()
          .describe('For a code document, its language (e.g. csharp or C#). Ignored for markdown.'),
      }),
      execute: (args: {
        format: string;
        title: string;
        content: string;
        language?: string;
      }): Promise<string> =>
        openDocument(context, args.format, args.title, args.content, args.language),
    }),
    // Not gated, like open_document: the target is the agent's own unsaved draft, so revising it is
    // no more consequential than having written it — and the renderer refuses any other document.
    [READ_DOCUMENT]: tool({
      description:
        'Read the current text of a document you opened with open_document, including any edits the user has made to it since. Read it before revising it.',
      inputSchema: z.object({
        id: z.string().min(1).describe('The id returned by open_document.'),
      }),
      execute: (args: { id: string }): Promise<string> => readDocument(context, args.id),
    }),
    [EDIT_DOCUMENT]: tool({
      description:
        'Revise a document you opened with open_document, in place in its tab: replace one exact occurrence of a string (or every occurrence with replace_all). Use this — not a new open_document — when the user asks for changes to a document you already opened. The old string must match uniquely; include surrounding context to disambiguate.',
      inputSchema: z.object({
        id: z.string().min(1).describe('The id returned by open_document.'),
        old_string: z
          .string()
          .min(1)
          .describe('The exact text to replace; must match the document verbatim.'),
        new_string: z.string().describe('The replacement text (empty deletes the matched text).'),
        replace_all: z
          .boolean()
          .optional()
          .describe(
            'Whether to replace every occurrence instead of requiring a unique match. Defaults to false.',
          ),
      }),
      execute: (args: {
        id: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      }): Promise<string> =>
        editDocument(context, args.id, args.old_string, args.new_string, args.replace_all ?? false),
    }),
    [REPLACE_DOCUMENT]: tool({
      description:
        'Replace the whole text of a document you opened with open_document, in place in its tab. Prefer edit_document for targeted changes; use this for a rewrite.',
      inputSchema: z.object({
        id: z.string().min(1).describe('The id returned by open_document.'),
        text: z.string().describe('The new full text of the document.'),
      }),
      execute: (args: { id: string; text: string }): Promise<string> =>
        replaceDocument(context, args.id, args.text),
    }),
    [SAVE_DOCUMENT]: tool({
      description:
        'Offer to save a document you opened with open_document, through the operating system save dialog. Call it only when the user has said they want to keep the document.',
      inputSchema: z.object({
        id: z.string().min(1).describe('The id returned by open_document.'),
      }),
      execute: (args: { id: string }): Promise<string> => saveDocument(context, args.id),
    }),
    [OPEN_FILE]: tool({
      description:
        "Open one of the user's own workspace files in their editor, so they can look at it while you talk about it. Prefer it to quoting a long passage back at them. It only opens the file — use the edit tools to change it.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe('An absolute path, or one relative to the workspace root.'),
      }),
      execute: (args: { path: string }): Promise<string> => openFile(context, args.path),
    }),
    // Gated, unlike the two document tools above: opening a terminal spawns a real shell process, so
    // it prompts under every posture but `auto-all` — matching the Claude path, where it is the one
    // workbench tool left out of `allowedTools`.
    [OPEN_TERMINAL]: tool({
      description:
        "Open a new terminal tab in the user's default shell. It spawns a real shell, so do not open one speculatively.",
      inputSchema: z.object({}),
      execute: gated(context, OPEN_TERMINAL, (): Promise<string> => openTerminal(context)),
    }),
  };
}

/**
 * Builds the run-configuration tools: reading the open workspace's Run dropdown, and authoring it.
 *
 * Registered on the **workspace-scoped** surfaces only — the IDE views (`editor`) and the standalone
 * agent tab (`project`). A terminal- or binary- or API-docked agent is deliberately confined to its own
 * surface, and authoring the workspace's launch configuration is not that surface's business.
 *
 * ⚠️ These were the one part of the Claude provider's tool set that had no equivalent here, which meant
 * an agent on any other connection simply could not author a run configuration. Moving the Claude
 * harness out of core made that gap load-bearing rather than merely untidy: a harness asks core for the
 * tools, so a tool core does not describe is a tool nobody gets.
 * @param context The run context the tools act through.
 * @returns Returns the run-configuration tool set, or an empty set where they do not belong.
 */
export async function createRunConfigurationTools(context: AgentRunContext): Promise<ToolSet> {
  if (context.mode === 'chat' || !WORKSPACE_SCOPED_SURFACES.includes(context.surface)) {
    return {};
  }
  const { tool } = await import('ai');
  const { z } = await import('zod');
  // Declared once and used by both the create and the update tool, so the two cannot drift into
  // describing different shapes of the same thing.
  const configuration: ReturnType<typeof z.object> = z.object({
    id: z.string().min(1).describe('Stable, unique, kebab-case identifier for the configuration.'),
    name: z
      .string()
      .min(1)
      .describe('Display name shown in the Run dropdown, written for a human.'),
    providerKind: z
      .string()
      .optional()
      .describe(
        'The ecosystem that runs it: dotnet, node, jvm, cpp, rust, go — or "compound" for a configuration with members.',
      ),
    mode: z
      .enum(['run', 'debug'])
      .optional()
      .describe('Whether it launches normally ("run", the default) or under the debugger.'),
    program: z
      .string()
      .optional()
      .describe(
        'The command or executable to launch. When set it wins; otherwise the command is derived from providerKind and id.',
      ),
    args: z.array(z.string()).optional().describe('Arguments passed to the program.'),
    cwd: z
      .string()
      .optional()
      .describe('Working directory to launch in; defaults to the workspace root.'),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe('Environment variables to launch with.'),
    members: z
      .array(z.string())
      .optional()
      .describe(
        'For a compound: the ids of the configurations to start in parallel. Every id must exist.',
      ),
  });
  return {
    // Listing is a read, so it runs without prompting — the agent can see what exists before deciding
    // whether to amend it, which is what stops it duplicating entries.
    [LIST_RUN_CONFIGURATIONS]: tool({
      description:
        "List the open workspace's run configurations (the entries in its Run dropdown, stored in .studio/workspace.json).",
      inputSchema: z.object({}),
      execute: (): Promise<string> => listRunConfigurations(context),
    }),
    [SAVE_RUN_CONFIGURATIONS]: tool({
      description:
        "Create or update the open workspace's run configurations. Entries are matched by id: a known id is replaced, a new id is added. A configuration with `members` is a compound that starts those configurations in parallel.",
      inputSchema: z.object({
        configurations: z
          .array(configuration)
          .min(1)
          .describe('The configurations to create or update.'),
      }),
      execute: gated(
        context,
        SAVE_RUN_CONFIGURATIONS,
        (args: { configurations: unknown[] }): Promise<string> =>
          saveRunConfigurations(context, args.configurations),
      ),
    }),
    [DELETE_RUN_CONFIGURATIONS]: tool({
      description: 'Delete run configurations from the open workspace by id.',
      inputSchema: z.object({
        ids: z.array(z.string().min(1)).min(1).describe('The ids of the configurations to delete.'),
      }),
      execute: gated(
        context,
        DELETE_RUN_CONFIGURATIONS,
        (args: { ids: string[] }): Promise<string> => deleteRunConfigurations(context, args.ids),
      ),
    }),
  };
}

/**
 * Builds the API Explorer tools for an API-surface run: reading the collections, creating and
 * changing saved requests, sending one, and setting an environment variable. The handlers are the
 * same provider-agnostic ones the Claude path uses — only the tool-definition dialect differs — so
 * an agent on an OpenAI or Gemini connection has the same capabilities as one on Claude.
 * @param context The run context the tools act through.
 * @returns Returns the API tool set.
 */
export async function createApiTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const readTools: ToolSet = {
    [LIST_API_REQUESTS]: tool({
      description: "List the API Explorer's collections, saved requests and environments.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => listApiRequests(context),
    }),
  };
  // Chat mode is read-only: the agent may look at the collections but not add to them or send.
  if (context.mode === 'chat') {
    return readTools;
  }
  return {
    ...readTools,
    [CREATE_API_REQUEST]: tool({
      description:
        'Save a new request in the API Explorer and open it in the API well. Reference environment values as {{name}} rather than hard-coding hosts or tokens.',
      inputSchema: z.object({
        name: z.string().min(1).describe('The display name of the request.'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
          .describe('The HTTP method.'),
        url: z.string().min(1).describe('The request URL; may contain {{variables}}.'),
        description: z
          .string()
          .optional()
          .describe('What the endpoint does, what it expects and what it returns.'),
        collection: z
          .string()
          .optional()
          .describe('The collection to add it to; created when it does not exist.'),
        headers: z.record(z.string(), z.string()).optional().describe('Request headers.'),
        params: z.record(z.string(), z.string()).optional().describe('Query parameters.'),
        body: z.string().optional().describe('The request body.'),
        body_kind: z
          .enum(['none', 'json', 'text', 'xml'])
          .optional()
          .describe('How the body is carried.'),
      }),
      execute: (args: Record<string, unknown>): Promise<string> => createApiRequest(context, args),
    }),
    [UPDATE_API_REQUEST]: tool({
      description: 'Change a saved request. Anything not named is left as it was.',
      inputSchema: z.object({
        id: z.string().min(1).describe('The id of the request to change.'),
        name: z.string().optional().describe('A new display name.'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
          .optional()
          .describe('A new HTTP method.'),
        url: z.string().optional().describe('A new URL.'),
        description: z.string().optional().describe('A new description.'),
        headers: z.record(z.string(), z.string()).optional().describe('Replacement headers.'),
        params: z.record(z.string(), z.string()).optional().describe('Replacement parameters.'),
        body: z.string().optional().describe('A new body.'),
        body_kind: z
          .enum(['none', 'json', 'text', 'xml'])
          .optional()
          .describe('How the body is carried.'),
      }),
      execute: (args: { id: string } & Record<string, unknown>): Promise<string> =>
        updateApiRequest(context, args.id, args),
    }),
    [SEND_API_REQUEST]: tool({
      description:
        'Send a saved request and return its status, headers and body. This makes a real call to a real service.',
      inputSchema: z.object({ id: z.string().min(1).describe('The id of the request to send.') }),
      // Gated (#965): sending is a real call to a real service, and the posture is what decides
      // whether the user is asked first. Until then only the prompt held the agent back.
      execute: gated(context, SEND_API_REQUEST, (args: { id: string }): Promise<string> =>
        sendApiRequest(context, args.id),
      ),
    }),
    [SET_API_VARIABLE]: tool({
      description:
        "Set a variable in the API Explorer's active environment, so requests can reference it as {{name}}.",
      inputSchema: z.object({
        name: z.string().min(1).describe('The variable name.'),
        value: z.string().describe('The variable value.'),
      }),
      execute: (args: { name: string; value: string }): Promise<string> =>
        setApiVariable(context, args.name, args.value),
    }),
  };
}

/**
 * Builds the binary-surface tools every AI-SDK-backed provider exposes for a binary-scoped run,
 * bridged to the renderer through the run context. The agent inspects the open binary file (overview,
 * hex/ASCII windows, the selection, and disassembly) and can patch bytes; the renderer formats the
 * dumps, so the tools relay the rendered text. A chat-mode run carries only the read tools, and every
 * write tool asks through the permission round-trip unless the posture auto-allows everything — the
 * same rules the Claude path enforces. The `ai` and `zod` packages are imported dynamically to match
 * the providers' own dynamic-import (ESM-compatibility) convention.
 * @param context The run context the tools act through.
 * @returns Returns the tool set keyed by tool name, ready to pass to `streamText`.
 */
export async function createBinaryTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const readTools: ToolSet = {
    [READ_BINARY_OVERVIEW]: tool({
      description:
        'Describe the open binary file: path, size, container format, architecture, whether disassembly is available, and the current cursor/selection.',
      inputSchema: z.object({}),
      execute: (): Promise<string> => readBinaryOverview(context),
    }),
    [READ_BINARY_BYTES]: tool({
      description: 'Return a hex + ASCII dump of a byte range of the open binary file.',
      inputSchema: z.object({
        offset: z.number().int().min(0).describe('The first byte offset to read.'),
        length: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('The number of bytes to read (bounded; defaults to 256).'),
      }),
      execute: (args: { offset: number; length?: number }): Promise<string> =>
        readBinaryBytes(context, args.offset, args.length ?? 256),
    }),
    [READ_BINARY_SELECTION]: tool({
      description:
        'Return a hex + ASCII dump of the bytes the user has selected in the open binary file.',
      inputSchema: z.object({}),
      execute: (): Promise<string> => readBinarySelection(context),
    }),
    [READ_BINARY_DISASSEMBLY]: tool({
      description:
        'Return the assembly listing for a byte range of the open binary file, when its format is natively disassemblable.',
      inputSchema: z.object({
        offset: z.number().int().min(0).describe('The first byte of the range to disassemble.'),
        length: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('The number of bytes to disassemble (bounded; defaults to 256).'),
      }),
      execute: (args: { offset: number; length?: number }): Promise<string> =>
        readBinaryDisassembly(context, args.offset, args.length ?? 256),
    }),
  };
  if (context.mode === 'chat') {
    return readTools;
  }
  return {
    ...readTools,
    [PATCH_BINARY_BYTES]: tool({
      description:
        'Overwrite bytes at an offset in the open binary file (the length is unchanged). Produces an unsaved, undoable edit the user reviews and saves.',
      inputSchema: z.object({
        offset: z.number().int().min(0).describe('The offset to overwrite from.'),
        bytes: z
          .string()
          .describe('The replacement bytes as a hex string, e.g. "4d 5a" or "4D5A".'),
      }),
      execute: gated(
        context,
        PATCH_BINARY_BYTES,
        (args: { offset: number; bytes: string }): Promise<string> =>
          patchBinaryBytes(context, args.offset, args.bytes),
      ),
    }),
    [INSERT_BINARY_BYTES]: tool({
      description:
        'Insert bytes before an offset in the open binary file. CHANGES THE FILE LENGTH: every subsequent offset shifts, which typically corrupts structured executables — intended for blobs and data files. Produces an unsaved, undoable edit.',
      inputSchema: z.object({
        offset: z
          .number()
          .int()
          .min(0)
          .describe('The offset to insert before (the file size appends).'),
        bytes: z.string().describe('The bytes to insert as a hex string, e.g. "4d 5a" or "4D5A".'),
      }),
      execute: gated(
        context,
        INSERT_BINARY_BYTES,
        (args: { offset: number; bytes: string }): Promise<string> =>
          insertBinaryBytes(context, args.offset, args.bytes),
      ),
    }),
    [DELETE_BINARY_BYTES]: tool({
      description:
        'Delete a run of bytes from the open binary file. CHANGES THE FILE LENGTH: every subsequent offset shifts, which typically corrupts structured executables — intended for blobs and data files. Produces an unsaved, undoable edit.',
      inputSchema: z.object({
        offset: z.number().int().min(0).describe('The first offset to delete.'),
        length: z.number().int().min(1).describe('The number of bytes to delete.'),
      }),
      execute: gated(
        context,
        DELETE_BINARY_BYTES,
        (args: { offset: number; length: number }): Promise<string> =>
          deleteBinaryBytes(context, args.offset, args.length),
      ),
    }),
    [WRITE_BINARY_ASSEMBLY]: tool({
      description:
        'Assemble x86/x64 assembly text (Intel syntax, one instruction per line) and write it at an offset in the open binary file, editing at the instruction level. The file length is unchanged: pass the length of the range being replaced — shorter code is NOP-padded, longer code is rejected so it never shifts the following instructions. Covers x86 and x64 only (ARM/ARM64 cannot be assembled); code is assembled at address 0, so use PC-relative operands for branches. Reports the bytes written and their disassembly. Produces an unsaved, undoable edit.',
      inputSchema: z.object({
        offset: z.number().int().min(0).describe('The offset to write the assembled bytes at.'),
        assembly: z.string().min(1).describe('The assembly to write, e.g. "mov eax, 1; ret".'),
        length: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'The number of bytes the write should occupy (the replaced range); defaults to the assembled length. Shorter assembly is NOP-padded to this; longer is rejected.',
          ),
      }),
      execute: gated(
        context,
        WRITE_BINARY_ASSEMBLY,
        (args: { offset: number; assembly: string; length?: number }): Promise<string> =>
          writeBinaryAssembly(context, args.offset, args.assembly, args.length),
      ),
    }),
  };
}

/**
 * Builds the System Monitor's tools (#966): reading the log audit and the resource readings, and —
 * outside chat mode — changing the log level, gated because it is a setting that outlasts the run.
 * @param context The run context the tools act through.
 * @returns Returns the tool set.
 */
export async function createMonitorTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const readTools: ToolSet = {
    [LIST_LOG_SESSIONS]: tool({
      description: "List the app's log sessions (one per run of the app), newest first.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => listLogSessions(context),
    }),
    [QUERY_LOGS]: tool({
      description:
        'Read log records, newest first. Filter narrowly — by severity, a phrase, a time window — and widen only when that finds nothing.',
      inputSchema: z.object({
        session: z
          .string()
          .optional()
          .describe('A session id from list_log_sessions; omit for the current run.'),
        severities: z
          .array(z.enum(['trace', 'debug', 'info', 'warning', 'error']))
          .optional()
          .describe('Only these severities; omit for all of them.'),
        text: z
          .string()
          .optional()
          .describe('Only records whose message or source contains this, ignoring case.'),
        since: z.string().optional().describe('Only records at or after this ISO-8601 time.'),
        until: z.string().optional().describe('Only records at or before this ISO-8601 time.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(300)
          .optional()
          .describe('How many records to return, at most 300; 100 when omitted.'),
      }),
      execute: (args: {
        session?: string;
        severities?: string[];
        text?: string;
        since?: string;
        until?: string;
        limit?: number;
      }): Promise<string> => queryLogs(context, args),
    }),
    [READ_SYSTEM_METRICS]: tool({
      description:
        'Summarise the recent CPU, memory, GPU, network and disk readings: the latest, and the low, average and high over the sampled window.',
      inputSchema: z.object({}),
      execute: (): Promise<string> => readSystemMetrics(context),
    }),
  };
  if (context.mode === 'chat') {
    return readTools;
  }
  return {
    ...readTools,
    [SET_LOG_LEVEL]: tool({
      description:
        "Change how much the app logs. 'auto' is the default; 'trace' and 'debug' write far more and should be set back afterwards.",
      inputSchema: z.object({
        level: z
          .enum(['auto', 'trace', 'debug', 'info', 'warning', 'error'])
          .describe('The least severe records to keep.'),
      }),
      execute: gated(context, SET_LOG_LEVEL, (args: { level: string }): Promise<string> =>
        setLogLevel(context, args.level),
      ),
    }),
  };
}

/**
 * The most characters of a standing instruction the permission card quotes.
 */
const INSTRUCTION_PREVIEW_CHARS: number = 80;

/**
 * Describes a prompt profile or skill being written, for the permission card and the audit record:
 * its name, and the first line of what it will tell future agents — the part the user is being asked
 * to stand behind.
 * @param args The tool's input.
 * @returns Returns the description.
 */
export function describeStandingInstruction(args: Record<string, unknown>): string {
  const name: string =
    typeof args['name'] === 'string' && args['name'].length > 0
      ? args['name']
      : typeof args['id'] === 'string'
        ? args['id']
        : 'unnamed';
  const instructions: string =
    typeof args['instructions'] === 'string' ? args['instructions'].trim() : '';
  if (instructions.length === 0) {
    return name;
  }
  const firstLine: string = instructions.split('\n', 1)[0].trim();
  const preview: string =
    firstLine.length > INSTRUCTION_PREVIEW_CHARS
      ? `${firstLine.slice(0, INSTRUCTION_PREVIEW_CHARS - 1)}…`
      : firstLine;
  return `${name}: "${preview}"`;
}

/**
 * Builds the AI Manager's tools (#967): the local models, the prompt profiles and the skill library.
 * Chat mode reads only. Downloading, every delete, and writing a profile or a skill are gated. A
 * profile is a standing instruction every later agent obeys — on surfaces with file and shell tools —
 * and a skill is one an agent loads on its own judgement, so neither is written without the user
 * seeing what it says first (audit S9).
 * @param context The run context the tools act through.
 * @returns Returns the tool set.
 */
export async function createAiManagerTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const readTools: ToolSet = {
    [LIST_LOCAL_MODELS]: tool({
      description:
        'List the local model runtime, its installed and running models, and their disk use.',
      inputSchema: z.object({}),
      execute: (): Promise<string> => listLocalModels(context),
    }),
    [SEARCH_MODEL_CATALOG]: tool({
      description:
        "Search the catalogue of models that can be downloaded: each one's reference, size, parameters and description.",
      inputSchema: z.object({
        query: z.string().describe('What to search for, e.g. "qwen coder" or "embedding".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('How many results; 20 when omitted.'),
      }),
      execute: (args: { query: string; limit?: number }): Promise<string> =>
        searchModelCatalog(context, args.query, args.limit),
    }),
    [READ_MACHINE_FACTS]: tool({
      description:
        "Report the machine's memory, processor and architecture, to judge which models fit.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => Promise.resolve(readMachineFacts()),
    }),
    [LIST_PROMPT_PROFILES]: tool({
      description:
        "List the prompt profiles: each one's id, name, scope, whether it is on, and its instructions.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => listPromptProfiles(context),
    }),
    [LIST_SKILLS]: tool({
      description:
        "List the skill library: each skill's name, description, scope, technologies, whether it is on, and any problem.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => listSkills(context),
    }),
    [READ_SKILL]: tool({
      description: 'Read one skill in full, instructions included.',
      inputSchema: z.object({ name: z.string().min(1).describe("The skill's name.") }),
      execute: (args: { name: string }): Promise<string> => readSkill(context, args.name),
    }),
    [LIST_SKILL_TAGS]: tool({
      description:
        'List what a skill can be scoped to and tagged with: the surfaces, and the language and technology ids by category.',
      inputSchema: z.object({}),
      execute: (): Promise<string> => listSkillTags(context),
    }),
  };
  if (context.mode === 'chat') {
    return readTools;
  }
  return {
    ...readTools,
    [DOWNLOAD_MODEL]: tool({
      description:
        'Start downloading a model by its catalogue reference. It runs in the background; tell the user its size first.',
      inputSchema: z.object({
        ref: z.string().min(1).describe('The catalogue reference, e.g. qwen3:8b.'),
      }),
      execute: gated(context, DOWNLOAD_MODEL, (args: { ref: string }): Promise<string> =>
        downloadModel(context, args.ref),
      ),
    }),
    [DELETE_MODEL]: tool({
      description: "Delete an installed model's weights.",
      inputSchema: z.object({ name: z.string().min(1).describe("The installed model's name.") }),
      execute: gated(context, DELETE_MODEL, (args: { name: string }): Promise<string> =>
        deleteModel(context, args.name),
      ),
    }),
    [SAVE_PROMPT_PROFILE]: tool({
      description:
        'Create a prompt profile, or change one by its id. Anything not named is left as it was.',
      inputSchema: z.object({
        id: z.string().optional().describe('The profile to change; omit to create one.'),
        name: z.string().optional().describe('Its display name.'),
        instructions: z.string().optional().describe('The standing instructions, in Markdown.'),
        surfaces: z
          .array(
            z.enum([
              'editor',
              'terminal',
              'binary',
              'api',
              'workspace',
              'project',
              'monitor',
              'models',
            ]),
          )
          .optional()
          .describe('The surfaces it applies on; omit or leave empty for everywhere.'),
        languages: z
          .array(z.string())
          .optional()
          .describe('Editor language ids it narrows to; omit or leave empty for every language.'),
        enabled: z.boolean().optional().describe('Whether it is on.'),
      }),
      execute: gated(
        context,
        SAVE_PROMPT_PROFILE,
        (args: Record<string, unknown>): Promise<string> => savePromptProfile(context, args),
        describeStandingInstruction,
      ),
    }),
    [DELETE_PROMPT_PROFILE]: tool({
      description: 'Delete a prompt profile by its id.',
      inputSchema: z.object({ id: z.string().min(1).describe("The profile's id.") }),
      execute: gated(context, DELETE_PROMPT_PROFILE, (args: { id: string }): Promise<string> =>
        deletePromptProfile(context, args.id),
      ),
    }),
    [SAVE_SKILL]: tool({
      description:
        'Create a skill, or change one. Name it in lower-case letters, digits and hyphens. Anything not named is left as it was.',
      inputSchema: z.object({
        name: z.string().min(1).describe("The skill's name, which is also its folder's."),
        previous_name: z.string().optional().describe('The current name, when renaming.'),
        description: z
          .string()
          .optional()
          .describe('One paragraph saying what kind of task it is for.'),
        instructions: z.string().optional().describe('The instructions, in Markdown.'),
        surfaces: z
          .array(
            z.enum([
              'editor',
              'terminal',
              'binary',
              'api',
              'workspace',
              'project',
              'monitor',
              'models',
            ]),
          )
          .optional()
          .describe('The surfaces it applies on; omit or leave empty for everywhere.'),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            'Language and technology ids from list_skill_tags; omit or leave empty for none.',
          ),
        enabled: z.boolean().optional().describe('Whether it is offered to agents.'),
      }),
      execute: gated(
        context,
        SAVE_SKILL,
        (args: Record<string, unknown>): Promise<string> => saveSkill(context, args),
        describeStandingInstruction,
      ),
    }),
    [DELETE_SKILL]: tool({
      description: 'Delete a skill, and its folder on disk.',
      inputSchema: z.object({ name: z.string().min(1).describe("The skill's name.") }),
      execute: gated(context, DELETE_SKILL, (args: { name: string }): Promise<string> =>
        deleteSkill(context, args.name),
      ),
    }),
  };
}

/**
 * Builds the Plugin Manager's tools (#968). Installing is not wrapped in the permission prompt: it
 * raises the plugin's consent window, which asks the user the same question with the terms in front
 * of them, and asking twice would teach them to click through both. Uninstalling is gated.
 * @param context The run context the tools act through.
 * @returns Returns the tool set.
 */
export async function createPluginManagerTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const readTools: ToolSet = {
    [LIST_PLUGINS]: tool({
      description:
        "List the plugins: each one's id, name, description, state, version, any update waiting, and what it contributes — slots and the languages it serves.",
      inputSchema: z.object({
        filter: z
          .enum(['all', 'installed', 'available', 'updates'])
          .optional()
          .describe('Which plugins to list; all when omitted.'),
      }),
      execute: (args: { filter?: string }): Promise<string> => listPlugins(context, args.filter),
    }),
    [READ_WORKSPACE_LANGUAGES]: tool({
      description:
        "Report the user's open workspaces: each one's folder, its ecosystem (dotnet, node, python, …) and the languages that implies.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => readWorkspaceLanguages(context),
    }),
  };
  if (context.mode === 'chat') {
    return readTools;
  }
  return {
    ...readTools,
    [INSTALL_PLUGIN]: tool({
      description:
        'Install a plugin, or update an installed one, by its id. Studio shows the user its terms first and installs only if they accept.',
      inputSchema: z.object({ id: z.string().min(1).describe("The plugin's id.") }),
      execute: (args: { id: string }): Promise<string> => installPlugin(context, args.id),
    }),
    [UNINSTALL_PLUGIN]: tool({
      description: 'Uninstall a plugin by its id.',
      inputSchema: z.object({ id: z.string().min(1).describe("The plugin's id.") }),
      execute: gated(context, UNINSTALL_PLUGIN, (args: { id: string }): Promise<string> =>
        uninstallPlugin(context, args.id),
      ),
    }),
  };
}

/**
 * Builds the Containers view's tools (#969). Starting, stopping, restarting, pausing and resuming are
 * not wrapped in the permission prompt: each is undone by another. Pulling, running and removing are
 * gated — a pull can be gigabytes, a run can publish ports and mount folders, and a removed volume's
 * data is gone.
 * @param context The run context the tools act through.
 * @returns Returns the tool set.
 */
export async function createContainersTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const id: ReturnType<typeof z.string> = z.string().min(1).describe("The container's name or id.");
  const readTools: ToolSet = {
    [LIST_CONTAINERS]: tool({
      description:
        "List the containers: each one's id, name, image, state, status, published ports, mounted volumes, and CPU and memory while it runs.",
      inputSchema: z.object({
        runningOnly: z.boolean().optional().describe('List only running containers.'),
      }),
      execute: (args: { runningOnly?: boolean }): Promise<string> =>
        listContainers(context, args.runningOnly),
    }),
    [LIST_CONTAINER_IMAGES]: tool({
      description:
        "List the images on this machine: each one's id, tags, size and the containers using it.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => listContainerImages(context),
    }),
    [LIST_CONTAINER_VOLUMES]: tool({
      description: "List the volumes: each one's name, driver, and the containers mounting it.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => listContainerVolumes(context),
    }),
    [READ_CONTAINER_LOGS]: tool({
      description: "Read a container's most recent log lines, oldest first.",
      inputSchema: z.object({
        id,
        tail: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe('How many lines, at most; 200 when omitted.'),
      }),
      execute: (args: { id: string; tail?: number }): Promise<string> =>
        readContainerLogs(context, args.id, args.tail),
    }),
  };
  if (context.mode === 'chat') {
    return readTools;
  }
  return {
    ...readTools,
    [CONTROL_CONTAINER]: tool({
      description: 'Start, stop, restart, pause or resume a container.',
      inputSchema: z.object({
        id,
        action: z.enum(['start', 'stop', 'restart', 'pause', 'resume']),
      }),
      execute: (args: { id: string; action: string }): Promise<string> =>
        controlContainer(context, args.id, args.action),
    }),
    [RUN_CONTAINER]: tool({
      description:
        'Run a new container from an image on this machine, and start it. Pull the image first when it is not here.',
      inputSchema: z.object({
        image: z.string().min(1).describe('The image, as in postgres:16.'),
        name: z
          .string()
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
          .optional()
          .describe("The container's name."),
        ports: z
          .array(
            z.object({
              host: z.number().int().min(1).max(65535),
              container: z.number().int().min(1).max(65535),
              protocol: z.enum(['tcp', 'udp']).optional(),
            }),
          )
          .optional()
          .describe('Ports to publish: the port on this machine, and the port inside.'),
        env: z.record(z.string(), z.string()).optional().describe('Environment variables.'),
        volumes: z
          .array(
            z.object({
              source: z.string().min(1).describe('A volume name, or a folder on this machine.'),
              target: z.string().startsWith('/').describe('Where it mounts inside.'),
              readOnly: z.boolean().optional(),
            }),
          )
          .optional()
          .describe('What to mount.'),
      }),
      execute: ((): ((args: RunContainerRequest) => Promise<string>) => {
        const run: (args: RunContainerRequest) => Promise<string> = gated(
          context,
          RUN_CONTAINER,
          (args: RunContainerRequest): Promise<string> => runContainer(context, args),
          describeRunRequest,
        );
        // A mount outside the write area is refused before the prompt, not put to the user: the area
        // is a fixed boundary (audit S3).
        return (args: RunContainerRequest): Promise<string> => {
          const refusal: string | null = refuseUnconfinedMounts(context, args);
          return refusal === null ? run(args) : Promise.resolve(refusal);
        };
      })(),
    }),
    [PULL_IMAGE]: tool({
      description: 'Download an image, as in postgres:16. Waits until it has arrived.',
      inputSchema: z.object({ reference: z.string().min(1).describe('The image reference.') }),
      execute: gated(context, PULL_IMAGE, (args: { reference: string }): Promise<string> =>
        pullImage(context, args.reference),
      ),
    }),
    [REMOVE_CONTAINER]: tool({
      description: 'Remove a container, stopping it first when it runs.',
      inputSchema: z.object({ id }),
      execute: gated(context, REMOVE_CONTAINER, (args: { id: string }): Promise<string> =>
        removeContainer(context, args.id),
      ),
    }),
    [REMOVE_IMAGE]: tool({
      description: 'Remove an image by its tag or id. Refused while a container uses it.',
      inputSchema: z.object({ id: z.string().min(1).describe("The image's tag or id.") }),
      execute: gated(context, REMOVE_IMAGE, (args: { id: string }): Promise<string> =>
        removeImage(context, args.id),
      ),
    }),
    [REMOVE_VOLUME]: tool({
      description:
        'Remove a volume and the data in it, which cannot be got back. Refused while a container mounts it.',
      inputSchema: z.object({ name: z.string().min(1).describe("The volume's name.") }),
      execute: gated(context, REMOVE_VOLUME, (args: { name: string }): Promise<string> =>
        removeVolume(context, args.name),
      ),
    }),
  };
}

/**
 * Selects the system-prompt appendix for a run: the terminal, binary, or (default) editor surface
 * guidance, plus the ask-user guidance every surface carries, plus the read-only note on a chat-mode
 * run. Shared by the AI-SDK-backed providers so the run-to-prompt mapping lives in one place and
 * matches the Claude path.
 * @param context The run context (carries the surface and mode).
 * @returns Returns the prompt appendix text.
 */
export function promptForSurface(
  context: AgentRunContext,
  options: { readonly nativeAsk?: boolean } = {},
): string {
  const surface: AgentSurface = context.surface;
  const base: string = ((): string => {
    switch (surface) {
      case 'terminal':
        return TERMINAL_PROMPT_APPENDIX;
      case 'binary':
        return BINARY_PROMPT_APPENDIX;
      case 'api':
        return API_PROMPT_APPENDIX;
      case 'workspace':
        return WORKSPACE_PROMPT_APPENDIX;
      case 'project':
        return PROJECT_PROMPT_APPENDIX;
      case 'editor':
        return STUDIO_PROMPT_APPENDIX;
      case 'monitor':
        return MONITOR_PROMPT_APPENDIX;
      case 'models':
        return AI_MANAGER_PROMPT_APPENDIX;
      case 'plugins':
        return PLUGIN_MANAGER_PROMPT_APPENDIX;
      case 'containers':
        return CONTAINERS_PROMPT_APPENDIX;
    }
  })();
  // A caller whose model has its own clarifying-question tool gets the tool-agnostic wording: the
  // instruction to ask rather than guess still applies, but naming a Studio tool it was not given
  // would point the model at something absent from its list.
  const withAsk: string = `${base}\n\n${options.nativeAsk === true ? CLARIFYING_QUESTION_APPENDIX : ASK_USER_PROMPT_APPENDIX}`;
  // A tool view's agent holds its view's tools and nothing of Studio's at large (#964), so it is told
  // about nothing else: no workbench, no run configurations, no hosting. Describing tools it was not
  // given would only invite it to reach for them.
  if (isToolViewSurface(surface)) {
    const scoped: string =
      context.mode === 'chat' ? `${withAsk}\n\n${READ_ONLY_APPENDIX}` : withAsk;
    const listed: string = skillsAppendix(context);
    return withSystemPromptExtra(listed.length === 0 ? scoped : `${scoped}\n\n${listed}`, context);
  }
  const studio: string = ((): string => {
    // The workbench tools are registered on every surface, so every surface is told about them —
    // except in chat mode, where they are withheld and describing them would only invite a refusal.
    if (context.mode === 'chat') {
      return `${withAsk}\n\n${READ_ONLY_APPENDIX}`;
    }
    const withWorkbench: string = `${withAsk}\n\n${WORKBENCH_PROMPT_APPENDIX}`;
    // The run-configuration tools are registered on the workspace-scoped surfaces only, so only those
    // are told how to author them. Kept in step with `createRunConfigurationTools` by hand, which is
    // the cost of the guidance and the tools being two things; describing tools that are not there is
    // the failure this condition exists to avoid.
    return WORKSPACE_SCOPED_SURFACES.includes(surface)
      ? `${withWorkbench}\n\n${RUN_CONFIGURATION_PROMPT_APPENDIX}`
      : withWorkbench;
  })();
  // The hosting tools' guidance rides with the rest of Studio's, and only where they are offered —
  // both are derived from `offeredHostingTools`, so they cannot disagree (#852).
  const hosting: string = hostingPromptAppendix(context);
  const withHosting: string = hosting.length === 0 ? studio : `${studio}\n\n${hosting}`;
  // The user's layers come last, and in this order: the skills listing describes a tool the model
  // holds, so it belongs with Studio's tool guidance; the standing text is the user's own voice and
  // reads as such only once everything Studio has to say is above it.
  const skills: string = skillsAppendix(context);
  return withSystemPromptExtra(
    skills.length === 0 ? withHosting : `${withHosting}\n\n${skills}`,
    context,
  );
}

/**
 * Builds the standalone agent tab's own tool (#876): offering the user a workspace for the project the
 * agent has been planning with them.
 * @param context The run context the tool acts through.
 * @returns Returns the tool set.
 */
export async function createProjectTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    [PROPOSE_WORKSPACE]: tool({
      description: PROPOSE_WORKSPACE_DESCRIPTION,
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(100)
          .describe(
            "The project's folder name: letters, digits, dots, hyphens and underscores, e.g. invoice-tracker.",
          ),
        summary: z
          .string()
          .max(2000)
          .optional()
          .describe('A sentence or two saying what the project is, shown on the card.'),
        handoff: z
          .string()
          .min(1)
          .max(256 * 1024)
          .describe(
            "Markdown for the workspace's agent: the plan, the decisions made and why, and what to do first.",
          ),
      }),
      execute: (args: { name: string; summary?: string; handoff: string }): Promise<string> =>
        Promise.resolve(proposeWorkspace(context, args)),
    }),
  };
}

/**
 * Builds the tool set for a run's surface: the terminal, binary, or (default) editor tools, plus the
 * ask-user tool every surface carries. Shared by the AI-SDK-backed providers so the surface-to-tools
 * mapping lives in one place.
 * @param context The run context the tools act through.
 * @returns Returns the tool set for the run's surface.
 */
export async function toolsForSurface(context: AgentRunContext): Promise<ToolSet> {
  const askUserTool: ToolSet = await createAskUserTool(context);
  // A tool view's agent is kept to its view (#964): its own tools, the clarifying question and the
  // skills — none of the workbench, run-configuration or hosting tools every other surface carries.
  if (isToolViewSurface(context.surface)) {
    return {
      ...askUserTool,
      ...(await createSkillTools(context)),
      ...(await createToolViewTools(context)),
    };
  }
  // The workbench tools ride on every surface — see createWorkbenchTools.
  const workbenchTools: ToolSet = await createWorkbenchTools(context);
  // The run-configuration tools ride on the workspace-scoped surfaces only, and decide that for
  // themselves — see createRunConfigurationTools.
  const runConfigurationTools: ToolSet = await createRunConfigurationTools(context);
  // The skill tool rides on every surface and decides for itself whether it applies (#301).
  const skillTools: ToolSet = await createSkillTools(context);
  // The hosting tools ride wherever the run works in a hosted repository, and decide for themselves
  // which operations the repository allows (#852).
  const hostingTools: ToolSet = await createHostingTools(context);
  const surfaceTools: ToolSet = await ((): Promise<ToolSet> => {
    switch (context.surface) {
      case 'terminal':
        return createTerminalTools(context);
      case 'binary':
        return createBinaryTools(context);
      case 'api':
        return createApiTools(context);
      case 'workspace':
        return createWorkspaceTools(context);
      // The standalone agent has no owning document, and the AI-SDK providers have no built-in tools:
      // a project run carries the ask-user tool and the one that moves the plan into a workspace.
      case 'project':
        return createProjectTools(context);
      case 'editor':
        return createStudioTools(context);
      case 'monitor':
      case 'models':
      case 'plugins':
      case 'containers':
        return createToolViewTools(context);
    }
  })();
  return {
    ...askUserTool,
    ...workbenchTools,
    ...runConfigurationTools,
    ...skillTools,
    ...hostingTools,
    ...surfaceTools,
  };
}

/**
 * Builds a tool view's own tools (#964), by its surface. Empty for any other surface.
 * @param context The run context the tools act through.
 * @returns Returns the tool set.
 */
async function createToolViewTools(context: AgentRunContext): Promise<ToolSet> {
  switch (context.surface) {
    case 'monitor':
      return createMonitorTools(context);
    case 'models':
      return createAiManagerTools(context);
    case 'plugins':
      return createPluginManagerTools(context);
    case 'containers':
      return createContainersTools(context);
    default:
      return {};
  }
}
