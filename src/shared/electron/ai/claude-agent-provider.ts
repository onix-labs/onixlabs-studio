import { homedir } from 'node:os';
import type {
  CanUseTool,
  HookJSONOutput,
  McpSdkServerConfigWithInstance,
  ModelInfo,
  Options,
  PermissionResult,
  PostToolUseHookInput,
  Query,
  SDKMessage,
  SDKUserMessage,
  SlashCommand,
} from '@anthropic-ai/claude-agent-sdk';
import {
  ASK_USER,
  DELETE_RUN_CONFIGURATIONS,
  LIST_RUN_CONFIGURATIONS,
  SAVE_RUN_CONFIGURATIONS,
  DELETE_BINARY_BYTES,
  EDIT_ACTIVE_DOCUMENT,
  INSERT_ACTIVE_DOCUMENT,
  INSERT_BINARY_BYTES,
  PATCH_BINARY_BYTES,
  READ_ACTIVE_DOCUMENT,
  READ_BINARY_BYTES,
  READ_BINARY_DISASSEMBLY,
  READ_BINARY_OVERVIEW,
  READ_BINARY_SELECTION,
  READ_TERMINAL_OUTPUT,
  REPLACE_ACTIVE_DOCUMENT,
  RUN_ACTIVE_DOCUMENT,
  SET_ACTIVE_DOCUMENT_LANGUAGE,
  WRITE_BINARY_ASSEMBLY,
  WRITE_TERMINAL_INPUT,
  type InsertPlacement,
  type AgentSurface,
  type AiEffort,
  type AiImageRef,
  type AiInputChoice,
  type AiModelInfo,
  type AiPermissionPosture,
  type ClaudeExecutableChoice,
  type AiProviderId,
  type AiToolPolicy,
} from '@shared/api/ai-types';
import type {
  AgentAuth,
  AgentProvider,
  AgentRunContext,
  AgentSession,
  AgentSessionModel,
  ProviderAvailability,
} from './agent-provider';
import { resolveClaudeExecutable } from './claude-executable';
import type { ClaudeSdkModel } from './claude-model-discovery';
import {
  applyCapturedEnvironment,
  captureShellEnvironmentCached,
} from '@shared/electron/shell-env';
import {
  ASK_USER_DESCRIPTION,
  ASK_USER_FQN,
  ASK_USER_PROMPT_APPENDIX,
  BINARY_PROMPT_APPENDIX,
  EDIT_TOOL_FQN,
  INSERT_TOOL_FQN,
  PROJECT_PROMPT_APPENDIX,
  RUN_CONFIGURATION_PROMPT_APPENDIX,
  LIST_RUN_CONFIGURATIONS_FQN,
  listRunConfigurations,
  saveRunConfigurations,
  deleteRunConfigurations,
  READ_ONLY_APPENDIX,
  READ_BINARY_BYTES_FQN,
  READ_BINARY_DISASSEMBLY_FQN,
  READ_BINARY_OVERVIEW_FQN,
  READ_BINARY_SELECTION_FQN,
  READ_TERMINAL_FQN,
  READ_TOOL_FQN,
  REPLACE_TOOL_FQN,
  SET_LANGUAGE_TOOL_FQN,
  STUDIO_PROMPT_APPENDIX,
  TERMINAL_PROMPT_APPENDIX,
  WRITE_TERMINAL_FQN,
  askUser,
  buildRunPrompt,
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
} from './studio-tools';
import {
  formatToolInput,
  formatToolOutput,
  prettyToolName,
  summarizeToolInput,
} from './tool-format';
import { coarseGrantSource } from './tool-policy';
import {
  CONFINED_WRITE_TOOLS,
  isWriteDenied,
  isWriteWithinRoots,
  writeTargetPath,
} from './write-confinement';

/**
 * Holds the built-in tools auto-allowed when a workspace is open: read-only project exploration.
 * These are always allowed regardless of the permission posture.
 */
const READ_ONLY_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep'];

/**
 * Holds the built-in file-editing tools auto-allowed under the `auto-edits` permission posture.
 */
const EDIT_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/**
 * Holds built-in tools the audit log ignores beyond the read-only set (#311): planning/delegation
 * tools that are not themselves mutating/exec actions. A delegated sub-agent's own tool uses are
 * still audited through their own `PostToolUse` events.
 */
const AUDIT_SKIP_TOOLS: readonly string[] = ['Task', 'TodoWrite'];

/**
 * Holds the read-only binary tools auto-allowed on a binary-surface run, so the agent can inspect the
 * file without prompting. The byte-patching tool is intentionally excluded: it flows through the
 * permission broker instead.
 */
const BINARY_READ_FQNS: readonly string[] = [
  READ_BINARY_OVERVIEW_FQN,
  READ_BINARY_BYTES_FQN,
  READ_BINARY_SELECTION_FQN,
  READ_BINARY_DISASSEMBLY_FQN,
];

/**
 * A loosely-typed content block from an SDK message, covering the fields read here.
 */
interface ContentBlock {
  /**
   * Gets the block type (`text`, `thinking`, `tool_use`, `tool_result`, …).
   */
  readonly type: string;
  readonly text?: string;
  readonly thinking?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  readonly tool_use_id?: string;
  readonly is_error?: boolean;
  readonly content?: unknown;
}

/**
 * The token counts an SDK message or terminal result carries. A single message's counts are a true
 * snapshot of one model round-trip; the terminal result's counts are the turn's cumulative billing
 * total, summed across every round-trip.
 */
interface SdkTokenUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

/**
 * Per-run state threaded through the message loop: the last cumulative cost reported (so each result
 * carries only its turn's delta) and the last top-level assistant message's usage (the true context
 * occupancy snapshot, used to drive the context meter instead of the inflated result aggregate).
 */
interface RunUsageState {
  lastCostUsd: number;
  lastAssistantUsage: SdkTokenUsage | null;
}

/**
 * The Claude Agent SDK implementation of {@link AgentProvider}. Wraps the SDK's `query()` agent loop,
 * parses its message stream into the shared event protocol, and authenticates from the local Claude
 * login or an API key. The SDK is ESM-only and the main process compiles to CommonJS, so it is loaded
 * with a dynamic `import()`. The streaming run auto-allows read-only project tools and denies the rest
 * until the permission broker (#113) lands.
 */
export class ClaudeAgentProvider implements AgentProvider {
  /**
   * Gets the provider's stable identifier.
   */
  public readonly id: AiProviderId = 'claude';

  /**
   * Gets the provider's human-readable label.
   */
  public readonly label: string = 'Claude (Agent SDK)';

  /**
   * Gets the models Claude can run a turn with, in display order.
   */
  public readonly models: readonly AiModelInfo[];

  /**
   * Gets the identifier of Claude's default model.
   */
  public readonly defaultModelId: string;

  /**
   * Gets a value indicating whether the provider accepts image input (Claude models are multimodal).
   */
  public readonly supportsImages: boolean = true;

  /**
   * Gets the reasoning-effort levels the Claude Agent SDK offers (the SDK `EffortLevel`: no `minimal`).
   */
  public readonly supportedEfforts: readonly AiEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

  /**
   * Gets the session model: the Claude Agent SDK is a live-harness — it is driven as a subprocess and can
   * hold a session open across turns (#324). The live-session runtime lands in P3 (#327).
   */
  public readonly sessionModel: AgentSessionModel = 'live-harness';

  /**
   * Initialises a new instance of the {@link ClaudeAgentProvider} class.
   * @param models The models the connection offers, in display order.
   * @param defaultModelId The identifier of the connection's default model.
   */
  public constructor(models: readonly AiModelInfo[], defaultModelId: string) {
    this.models = models;
    this.defaultModelId = defaultModelId;
  }

  /**
   * Reports whether Claude can run: a local login or an API key is enough.
   * @param auth The resolved credential material.
   * @returns Returns the availability descriptor.
   */
  public describeAvailability(auth: AgentAuth): ProviderAvailability {
    if (auth.hasLocalLogin) {
      return { available: true, detail: 'Using your local Claude login.' };
    }
    if (auth.apiKey !== null) {
      return { available: true, detail: 'Using your Anthropic API key.' };
    }
    return { available: false, detail: 'Run `claude` to log in, or add an Anthropic API key.' };
  }

  /**
   * Builds the SDK `query()` options for a turn: the surface/mode-scoped in-app MCP tools, the
   * permission gate, the audit hook, sandbox/confinement, the system prompt, and resume/budget.
   * Extracted from the old single-shot `run()` so a {@link ClaudeAgentSession} holds the query open
   * across turns (#324/#327).
   *
   * The options are built once, when the session opens, from the opening context (`openContext`): the
   * structural fields bound into the subprocess — cwd, the MCP tool set, allowed/disallowed tools,
   * sandbox, system prompt, resume, env, the opening model — are frozen there, which is why the
   * live-session router (`AiManager.isCompatibleTurn`) reopens the session when any of those change.
   * The per-turn closures (each MCP tool handler, `canUseTool`, the audit hook) instead read
   * `getContext()`, so across a held-open session they follow the CURRENT turn: its permission gate,
   * audit sink, request id, bridge, and per-turn policies/posture. The one exception is the model,
   * which is structural but changed live via `Query.setModel` (see {@link ClaudeAgentSession.turn}).
   * @param getContext Returns the session's current turn context; called once for the frozen fields and
   * per invocation inside the tool/gate/audit closures for the per-turn fields.
   * @param controller The session's abort controller, wired to the SDK query.
   * @returns Returns the assembled run options.
   */
  private async buildRunOptions(
    getContext: () => AgentRunContext,
    controller: AbortController,
  ): Promise<Options> {
    const { tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
    const { z } = await import('zod');
    // The context the session opens with; the frozen structural options below read it once.
    const openContext: AgentRunContext = getContext();
    const hasWorkspace: boolean = openContext.workspaceRoot !== null;
    const surface: AgentSurface = openContext.surface;
    const terminal: boolean = surface === 'terminal';
    const binary: boolean = surface === 'binary';
    // The standalone agent tab has no owning document: beyond the ask-user tool, no in-app studio
    // tools are registered, and the run works through the SDK's built-in tools alone (gated by the
    // permission posture as usual).
    const project: boolean = surface === 'project';
    // Chat mode runs read-only: the mutating in-app tool is withheld and every editing/executing tool
    // is denied, so the agent may inspect the project and the surface but never changes anything.
    const readOnly: boolean = openContext.mode === 'chat';
    // Attached files/folders are readable via the built-in Read/Glob tools even without an open
    // workspace, so those tools are auto-allowed when either a workspace or attached context is present.
    // Frozen at open (it gates the bound `allowedTools`); a later turn's fresh attachments still read
    // through the built-in Read/Glob tools, which `canUseTool` auto-allows regardless.
    const hasReadableContext: boolean = hasWorkspace || openContext.contextPaths.length > 0;

    // Write-confinement roots (#307): the filesystem area a granted file write may touch. The first
    // root is the run's working directory (the SDK's `cwd`), so a relative target anchors to the
    // workspace; the user's allowed write paths (#310) widen it. Left empty for a no-workspace run,
    // which keeps today's unconfined home-directory behaviour.
    const additionalDirectories: readonly string[] = openContext.allowedWritePaths;
    const confinementRoots: readonly string[] = hasWorkspace
      ? [openContext.workspaceRoot!, ...additionalDirectories]
      : [];

    // Tools the user's policy denies (#309) are removed from the model's context via the SDK's
    // `disallowedTools`, NOT left to the `canUseTool` gate: the Claude Code CLI auto-runs commands its
    // own safety classifier deems safe (e.g. `echo`) WITHOUT calling `canUseTool`, so a gate-only deny
    // would leak them. `disallowedTools` blocks the tool outright, whatever the classifier decides.
    // Keyed on display name, which equals the SDK name for these built-in tools. The `canUseTool` deny
    // below stays as a backstop for anything that does reach the gate.
    //
    // `AskUserQuestion` is always removed: it is the CLI's built-in multiple-choice ask tool, but it is
    // interactive-terminal-only and Studio has no seam to render it or return its answer. It is not a
    // `request_user_dialog` (only `refusal_fallback_prompt` uses `onUserDialog`); it resolves through an
    // Ink picker whose `tool_result` a headless host cannot supply. Left enabled, the model prefers it
    // over our own `ask_user`, hits the generic permission gate ("Allow AskUserQuestion?"), and — once
    // allowed — dead-ends into "No answer", silently proceeding on a guess. Removing it forces every
    // "ask the user" through `mcp__studio__ask_user`, which renders choices and blocks for a real answer.
    const disallowedTools: readonly string[] = [
      'AskUserQuestion',
      ...Object.entries(openContext.toolPolicies)
        .filter(([, value]: [string, string]): boolean => value === 'deny')
        .map(([tool]: [string, string]): string => tool),
    ];

    // Build a text-content tool result from a handler's rendered string.
    const text: (value: string) => { content: { type: 'text'; text: string }[] } = (
      value: string,
    ) => ({
      content: [{ type: 'text', text: value }],
    });

    // Expose Studio's in-app capabilities as an in-process MCP server; the tool handlers call back
    // into the renderer over the run context's bridge. Every surface registers the ask-user tool (the
    // input round-trip that lets the agent ask instead of guessing). Beyond that, a terminal-surface
    // run registers ONLY the two terminal tools, so the agent acts solely through its terminal; a
    // binary-surface run registers the binary inspection/patch tools; an editor run registers the
    // editor tools; a project run registers nothing further (the standalone agent works through the
    // SDK's built-in tools). Each tool array is inline so each tool keeps its own input-shape generic.
    const studioServer: McpSdkServerConfigWithInstance = createSdkMcpServer({
      name: 'studio',
      version: '0.0.0',
      tools: [
        tool(
          ASK_USER,
          ASK_USER_DESCRIPTION,
          {
            question: z.string().min(1).describe('The question to ask the user.'),
            choices: z
              .array(
                z.object({
                  label: z
                    .string()
                    .min(1)
                    .describe(
                      'The short answer label; sent back verbatim as the answer when picked.',
                    ),
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
          },
          async (args: { question: string; choices?: AiInputChoice[] }) =>
            text(await askUser(getContext(), args.question, args.choices ?? [])),
        ),
        // The run-configuration tools ride on the surfaces whose agents are workspace-scoped: the IDE
        // views (editor) and the standalone agent tab (project). A terminal- or binary-docked agent is
        // deliberately confined to its own surface and gets none of this. Withheld in read-only chat
        // mode, which never writes.
        ...(readOnly || terminal || binary
          ? []
          : [
              tool(
                LIST_RUN_CONFIGURATIONS,
                "List the open workspace's run configurations (the entries in its Run dropdown, stored in .studio/workspace.json).",
                {},
                async () => text(await listRunConfigurations(getContext())),
              ),
              tool(
                SAVE_RUN_CONFIGURATIONS,
                "Create or update the open workspace's run configurations. Entries are matched by id: a known id is replaced, a new id is added. A configuration with `members` is a compound that starts those configurations in parallel.",
                {
                  configurations: z
                    .array(
                      z.object({
                        id: z
                          .string()
                          .min(1)
                          .describe('Stable, unique, kebab-case identifier for the configuration.'),
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
                          .describe(
                            'Whether it launches normally ("run", the default) or under the debugger.',
                          ),
                        program: z
                          .string()
                          .optional()
                          .describe(
                            'The command or executable to launch. When set it wins; otherwise the command is derived from providerKind and id.',
                          ),
                        args: z
                          .array(z.string())
                          .optional()
                          .describe('Arguments passed to the program.'),
                        cwd: z
                          .string()
                          .optional()
                          .describe(
                            'Working directory to launch in; defaults to the workspace root.',
                          ),
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
                      }),
                    )
                    .min(1)
                    .describe('The configurations to create or update.'),
                },
                async (args: { configurations: unknown[] }) =>
                  text(await saveRunConfigurations(getContext(), args.configurations)),
              ),
              tool(
                DELETE_RUN_CONFIGURATIONS,
                'Delete run configurations from the open workspace by id.',
                {
                  ids: z
                    .array(z.string().min(1))
                    .min(1)
                    .describe('The ids of the configurations to delete.'),
                },
                async (args: { ids: string[] }) =>
                  text(await deleteRunConfigurations(getContext(), args.ids)),
              ),
            ]),
        ...(project
          ? []
          : terminal
            ? [
                tool(
                  READ_TERMINAL_OUTPUT,
                  'Read the recent output currently shown in the terminal.',
                  {},
                  async () => text(await readTerminalOutput(getContext())),
                ),
                ...(readOnly
                  ? []
                  : [
                      tool(
                        WRITE_TERMINAL_INPUT,
                        'Type text into the terminal, running it as a command by default, and return the resulting output.',
                        {
                          text: z.string().describe('The text to type into the terminal.'),
                          submit: z
                            .boolean()
                            .optional()
                            .describe(
                              'Whether to run the text as a command (append a newline). Defaults to true.',
                            ),
                        },
                        async (args: { text: string; submit?: boolean }) =>
                          text(
                            await writeTerminalInput(getContext(), args.text, args.submit ?? true),
                          ),
                      ),
                    ]),
              ]
            : binary
              ? [
                  tool(
                    READ_BINARY_OVERVIEW,
                    'Describe the open binary file: path, size, container format, architecture, whether disassembly is available, and the current cursor/selection.',
                    {},
                    async () => text(await readBinaryOverview(getContext())),
                  ),
                  tool(
                    READ_BINARY_BYTES,
                    'Return a hex + ASCII dump of a byte range of the open binary file.',
                    {
                      offset: z.number().int().min(0).describe('The first byte offset to read.'),
                      length: z
                        .number()
                        .int()
                        .min(1)
                        .optional()
                        .describe('The number of bytes to read (bounded; defaults to 256).'),
                    },
                    async (args: { offset: number; length?: number }) =>
                      text(await readBinaryBytes(getContext(), args.offset, args.length ?? 256)),
                  ),
                  tool(
                    READ_BINARY_SELECTION,
                    'Return a hex + ASCII dump of the bytes the user has selected in the open binary file.',
                    {},
                    async () => text(await readBinarySelection(getContext())),
                  ),
                  tool(
                    READ_BINARY_DISASSEMBLY,
                    'Return the assembly listing for a byte range of the open binary file, when its format is natively disassemblable.',
                    {
                      offset: z
                        .number()
                        .int()
                        .min(0)
                        .describe('The first byte of the range to disassemble.'),
                      length: z
                        .number()
                        .int()
                        .min(1)
                        .optional()
                        .describe('The number of bytes to disassemble (bounded; defaults to 256).'),
                    },
                    async (args: { offset: number; length?: number }) =>
                      text(
                        await readBinaryDisassembly(getContext(), args.offset, args.length ?? 256),
                      ),
                  ),
                  ...(readOnly
                    ? []
                    : [
                        tool(
                          PATCH_BINARY_BYTES,
                          'Overwrite bytes at an offset in the open binary file (the length is unchanged). Produces an unsaved, undoable edit the user reviews and saves.',
                          {
                            offset: z
                              .number()
                              .int()
                              .min(0)
                              .describe('The offset to overwrite from.'),
                            bytes: z
                              .string()
                              .describe(
                                'The replacement bytes as a hex string, e.g. "4d 5a" or "4D5A".',
                              ),
                          },
                          async (args: { offset: number; bytes: string }) =>
                            text(await patchBinaryBytes(getContext(), args.offset, args.bytes)),
                        ),
                        tool(
                          INSERT_BINARY_BYTES,
                          'Insert bytes before an offset in the open binary file. CHANGES THE FILE LENGTH: every subsequent offset shifts, which typically corrupts structured executables — intended for blobs and data files. Produces an unsaved, undoable edit.',
                          {
                            offset: z
                              .number()
                              .int()
                              .min(0)
                              .describe('The offset to insert before (the file size appends).'),
                            bytes: z
                              .string()
                              .describe(
                                'The bytes to insert as a hex string, e.g. "4d 5a" or "4D5A".',
                              ),
                          },
                          async (args: { offset: number; bytes: string }) =>
                            text(await insertBinaryBytes(getContext(), args.offset, args.bytes)),
                        ),
                        tool(
                          DELETE_BINARY_BYTES,
                          'Delete a run of bytes from the open binary file. CHANGES THE FILE LENGTH: every subsequent offset shifts, which typically corrupts structured executables — intended for blobs and data files. Produces an unsaved, undoable edit.',
                          {
                            offset: z.number().int().min(0).describe('The first offset to delete.'),
                            length: z
                              .number()
                              .int()
                              .min(1)
                              .describe('The number of bytes to delete.'),
                          },
                          async (args: { offset: number; length: number }) =>
                            text(await deleteBinaryBytes(getContext(), args.offset, args.length)),
                        ),
                        tool(
                          WRITE_BINARY_ASSEMBLY,
                          'Assemble x86/x64 assembly text (Intel syntax, one instruction per line) and write it at an offset in the open binary file, editing at the instruction level. The file length is unchanged: pass the length of the range being replaced — shorter code is NOP-padded, longer code is rejected so it never shifts the following instructions. Covers x86 and x64 only (ARM/ARM64 cannot be assembled); code is assembled at address 0, so use PC-relative operands for branches. Reports the bytes written and their disassembly. Produces an unsaved, undoable edit.',
                          {
                            offset: z
                              .number()
                              .int()
                              .min(0)
                              .describe('The offset to write the assembled bytes at.'),
                            assembly: z
                              .string()
                              .min(1)
                              .describe('The assembly to write, e.g. "mov eax, 1; ret".'),
                            length: z
                              .number()
                              .int()
                              .min(1)
                              .optional()
                              .describe(
                                'The number of bytes the write should occupy (the replaced range); defaults to the assembled length. Shorter assembly is NOP-padded to this; longer is rejected.',
                              ),
                          },
                          async (args: { offset: number; assembly: string; length?: number }) =>
                            text(
                              await writeBinaryAssembly(
                                getContext(),
                                args.offset,
                                args.assembly,
                                args.length,
                              ),
                            ),
                        ),
                      ]),
                ]
              : [
                  tool(
                    READ_ACTIVE_DOCUMENT,
                    "Read the active editor document's full text.",
                    {},
                    async () => text(await readActiveDocument(getContext())),
                  ),
                  ...(readOnly
                    ? []
                    : [
                        tool(
                          EDIT_ACTIVE_DOCUMENT,
                          'Replace one exact occurrence of a string in the active editor document (or every occurrence with replace_all). The old string must match uniquely — include surrounding context to disambiguate. Replace with an empty string to delete.',
                          {
                            old_string: z
                              .string()
                              .min(1)
                              .describe(
                                'The exact text to replace; must match the document verbatim.',
                              ),
                            new_string: z
                              .string()
                              .describe('The replacement text (empty deletes the matched text).'),
                            replace_all: z
                              .boolean()
                              .optional()
                              .describe(
                                'Whether to replace every occurrence instead of requiring a unique match. Defaults to false.',
                              ),
                          },
                          async (args: {
                            old_string: string;
                            new_string: string;
                            replace_all?: boolean;
                          }) =>
                            text(
                              await editActiveDocument(
                                getContext(),
                                args.old_string,
                                args.new_string,
                                args.replace_all ?? false,
                              ),
                            ),
                        ),
                        tool(
                          INSERT_ACTIVE_DOCUMENT,
                          "Insert text into the active editor document: before or after an anchor string (which must match uniquely), or at the document's start or end.",
                          {
                            text: z.string().min(1).describe('The text to insert.'),
                            placement: z
                              .enum(['before', 'after', 'start', 'end'])
                              .describe(
                                'Where to insert: relative to the anchor, or at a document edge.',
                              ),
                            anchor: z
                              .string()
                              .optional()
                              .describe(
                                'The exact anchor text for before/after placements; must match the document verbatim and uniquely.',
                              ),
                          },
                          async (args: { text: string; placement: string; anchor?: string }) =>
                            text(
                              await insertIntoActiveDocument(
                                getContext(),
                                args.text,
                                args.placement as InsertPlacement,
                                args.anchor,
                              ),
                            ),
                        ),
                        tool(
                          REPLACE_ACTIVE_DOCUMENT,
                          "Replace the active editor document's entire text. Prefer edit_active_document / insert_into_active_document for targeted changes.",
                          { text: z.string().describe('The new full text of the document.') },
                          async (args: { text: string }) =>
                            text(await replaceActiveDocument(getContext(), args.text)),
                        ),
                        tool(
                          SET_ACTIVE_DOCUMENT_LANGUAGE,
                          "Set the active editor document's language (syntax highlighting), e.g. when you write code in a language the editor is not yet set to. The editor re-highlights and the language picker updates. Use a Monaco language id such as csharp, typescript, python, rust, or go.",
                          {
                            language: z
                              .string()
                              .min(1)
                              .describe(
                                'The target language: a Monaco language id (e.g. csharp) or its display name (e.g. C#).',
                              ),
                          },
                          async (args: { language: string }) =>
                            text(await setActiveDocumentLanguage(getContext(), args.language)),
                        ),
                        tool(
                          RUN_ACTIVE_DOCUMENT,
                          "Run this tab's file in the code view's terminal and return its output and exit status, so you can check whether it ran successfully. Runs the live editor content (put your changes in the editor first with the edit tools). Supports javascript, typescript, python, csharp, java, kotlin, rust, go, and shell; other languages report that they cannot be run. The user sees it run in their terminal.",
                          {
                            timeout_seconds: z
                              .number()
                              .int()
                              .min(1)
                              .max(300)
                              .optional()
                              .describe(
                                'How long to wait for the program to finish before returning with whatever output it has (default 60, max 300). Raise it for a run you expect to take a while.',
                              ),
                          },
                          async (args: { timeout_seconds?: number }) =>
                            text(await runActiveDocument(getContext(), args.timeout_seconds ?? 60)),
                        ),
                      ]),
                ]),
      ],
    });

    // Apply the permission posture: read-only exploration is always allowed; `auto-all` allows every
    // tool; `auto-edits` also allows file edits but still asks before shell/exec; `prompt` asks before
    // anything mutating or executing. On allow, `updatedInput` MUST echo the original input — it is the
    // input the SDK runs the tool with; omitting it runs the tool with no arguments and fails as a
    // malformed response.
    const canUseTool: CanUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<PermissionResult> => {
      // Per-turn context: the gate follows the CURRENT turn's posture, policies, confinement, request
      // id, and permission prompt across a held-open session (the structural scope — terminal/readOnly/
      // confinementRoots — is frozen at open above and read from the closure).
      const context: AgentRunContext = getContext();
      const posture: AiPermissionPosture = context.permissionPosture;
      // The ask-user tool is allowed on every surface and in every mode (asking is read-only, and the
      // user's answer is itself the gate). It is normally short-circuited by allowedTools; this keeps
      // the confinement and read-only branches below from denying it if it ever lands here.
      if (toolName === ASK_USER_FQN) {
        return { behavior: 'allow', updatedInput: input };
      }
      // A terminal-surface run is confined to its terminal: deny every tool that is not one of the two
      // terminal tools, blocking all built-ins (file system, shell, editor). The write tool then falls
      // through to the posture logic below so it prompts unless the posture auto-allows.
      if (terminal && toolName !== READ_TERMINAL_FQN && toolName !== WRITE_TERMINAL_FQN) {
        return { behavior: 'deny', message: 'This agent can only use the terminal.' };
      }
      // Chat mode is read-only: allow read-only project exploration, deny anything mutating or
      // executing outright (no prompting). The read-only in-app tools are auto-allowed via
      // allowedTools and never reach here, so any tool that does is a write/exec tool to refuse.
      if (readOnly) {
        return READ_ONLY_TOOLS.includes(toolName)
          ? { behavior: 'allow', updatedInput: input }
          : {
              behavior: 'deny',
              message:
                'Chat mode is read-only — it can inspect but not modify files or run commands.',
            };
      }
      // Write confinement (#307/#310): a file write must not escape the allowed area (the workspace
      // root plus the user's allowed write paths), nor touch a denied path — even when a posture would
      // auto-allow it or the user grants it. Checked before the auto-allow short-circuit below so an
      // `auto-edits`/`auto-all` posture is confined too. Bash cannot be range-checked from its input
      // (an arbitrary command); the SDK sandbox backs it instead (see `sandbox` in options).
      if (CONFINED_WRITE_TOOLS.includes(toolName)) {
        const target: string | null = writeTargetPath(input);
        if (
          target !== null &&
          confinementRoots.length > 0 &&
          !isWriteWithinRoots(target, confinementRoots)
        ) {
          return {
            behavior: 'deny',
            // A deliberate hard boundary that approving the action cannot widen (a single approval must
            // not be able to escape the allowed filesystem area). Widening it is a configuration
            // decision — the allowed write paths in settings.
            message:
              `Blocked: "${target}" is outside the agent's allowed write area (the workspace root ` +
              `and your allowed write paths). This is a fixed safety boundary — add the location to ` +
              `your allowed write paths to permit it.`,
          };
        }
        if (
          target !== null &&
          isWriteDenied(target, context.deniedWritePaths, context.workspaceRoot ?? homedir())
        ) {
          return {
            behavior: 'deny',
            message: `Blocked: "${target}" is on your denied write paths and cannot be written to.`,
          };
        }
      }
      // Per-tool default policy (#309): the user's allow/ask/deny default, consulted ahead of the
      // posture and the prompt. `deny` refuses even when the posture would auto-allow; `allow` grants
      // without prompting (but the write confinement above still applies — it is not overridable). An
      // unset tool (or `ask`) falls through to the posture/prompt logic below, preserving today's
      // behaviour. Read-only tools never reach here, so no exclusion is needed.
      const displayName: string = prettyToolName(toolName);
      const policy: AiToolPolicy = context.toolPolicies[displayName] ?? 'ask';
      if (policy === 'deny') {
        return {
          behavior: 'deny',
          message: `Blocked: the ${displayName} tool is set to Deny in your agent settings.`,
        };
      }
      if (policy === 'allow') {
        return { behavior: 'allow', updatedInput: input };
      }
      const autoAllowed: boolean =
        READ_ONLY_TOOLS.includes(toolName) ||
        posture === 'auto-all' ||
        (posture === 'auto-edits' && EDIT_TOOLS.includes(toolName));
      if (autoAllowed) {
        return { behavior: 'allow', updatedInput: input };
      }
      const granted: boolean = await context.requestPermission(
        prettyToolName(toolName),
        summarizeToolInput(input),
      );
      return granted
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'The user declined to run this tool.' };
    };

    const options: Options = {
      // The opening model is bound here; a later turn that changes it is applied live via
      // `Query.setModel` (see {@link ClaudeAgentSession.turn}) rather than rebuilding the options.
      model: openContext.model,
      // Reasoning effort (#330), when the user selected one. Bound at open like the other structural
      // options (no live setter in the SDK Options seam), so a mid-session change takes effect on
      // reopen. `minimal` is excluded — it is not one of the SDK's effort levels (guarded so a stray
      // value never reaches the SDK, though the manager already clamps to `supportedEfforts`).
      ...(openContext.effort !== null && openContext.effort !== 'minimal'
        ? { effort: openContext.effort }
        : {}),
      cwd: openContext.workspaceRoot ?? homedir(),
      // Widen the confinement beyond `cwd` when additional directories are configured (#307). Empty
      // for now — the seam is what matters; omitted entirely when there is nothing to add.
      ...(additionalDirectories.length > 0
        ? { additionalDirectories: [...additionalDirectories] }
        : {}),
      // Hard-remove policy-denied tools (#309) so the model cannot use them at all — necessary for
      // Bash, whose "safe" commands the CLI classifier would otherwise auto-run before the gate.
      ...(disallowedTools.length > 0 ? { disallowedTools: [...disallowedTools] } : {}),
      // Audit every executed mutating/exec tool at the execution point (#311). `PostToolUse` fires for
      // ALL tools that actually ran — including commands the CLI classifier auto-runs without the
      // `canUseTool` gate, which the gate-based audit missed — and never fires for a denied tool. The
      // grant path is no longer distinguishable here, so the source is the coarse value computed from
      // the run's policy + posture. Read-only, in-app (`mcp__…`), and planning/delegation tools are
      // skipped. Best-effort: a hook must never break the run, so it always continues.
      hooks: {
        PostToolUse: [
          {
            hooks: [
              (input): Promise<HookJSONOutput> => {
                try {
                  // Per-turn context: audit the executed action against the CURRENT turn's policy,
                  // posture, and audit sink across a held-open session.
                  const context: AgentRunContext = getContext();
                  const post: PostToolUseHookInput = input as PostToolUseHookInput;
                  const raw: string = post.tool_name;
                  const auditable: boolean =
                    !READ_ONLY_TOOLS.includes(raw) &&
                    !AUDIT_SKIP_TOOLS.includes(raw) &&
                    !raw.startsWith('mcp__');
                  if (auditable) {
                    const displayName: string = prettyToolName(raw);
                    const policy: AiToolPolicy = context.toolPolicies[displayName] ?? 'ask';
                    context.recordAudit(
                      displayName,
                      summarizeToolInput(post.tool_input),
                      coarseGrantSource(
                        policy,
                        context.permissionPosture,
                        EDIT_TOOLS.includes(raw),
                      ),
                    );
                  }
                } catch {
                  // Auditing is best-effort; never let it disturb the run.
                }
                return Promise.resolve({ continue: true });
              },
            ],
          },
        ],
      },
      // Defence-in-depth for shell writes (#307): sandbox Bash so a granted command is filesystem-
      // confined by the OS sandbox on top of the interactive prompt (Bash targets cannot be range-
      // checked from their input the way a file write can). We do NOT auto-allow sandboxed Bash — it
      // still flows through the permission gate. `failIfUnavailable: false` degrades gracefully where
      // the platform sandbox is missing, running unsandboxed rather than failing the run.
      sandbox: { enabled: true, autoAllowBashIfSandboxed: false, failIfUnavailable: false },
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: this.systemAppendix(surface, readOnly),
      },
      // Every surface registers the in-app server: at minimum it carries the ask-user tool, and a
      // project run carries only that (the standalone agent otherwise works through the SDK's
      // built-in tools alone).
      mcpServers: { studio: studioServer },
      // The ask-user tool is auto-allowed on every surface: asking is not a mutation, and the user's
      // answer is itself the gate. For a terminal run, auto-allow only the read tool beyond that; the
      // write tool is intentionally omitted so it flows through canUseTool (prompting unless the
      // posture auto-allows). For a binary run, auto-allow the read-only inspection tools (and
      // read-only project exploration); the byte-patch tool is omitted so it flows through canUseTool.
      // For an editor run, auto-allow the in-app editor tools (the user sees and can undo the change)
      // and read-only project exploration; canUseTool gates everything else. A project run auto-allows
      // read-only exploration only.
      allowedTools: [
        ASK_USER_FQN,
        // Listing run configurations is a read: auto-allowed wherever the tools are registered, so the
        // agent can see what exists without a prompt. Saving and deleting are writes and go through
        // canUseTool like any other mutation.
        ...(readOnly || terminal || binary ? [] : [LIST_RUN_CONFIGURATIONS_FQN]),
        ...(terminal
          ? [READ_TERMINAL_FQN]
          : binary
            ? [...BINARY_READ_FQNS, ...(hasReadableContext ? READ_ONLY_TOOLS : [])]
            : project
              ? [...(hasReadableContext ? READ_ONLY_TOOLS : [])]
              : [
                  READ_TOOL_FQN,
                  ...(readOnly
                    ? []
                    : [EDIT_TOOL_FQN, INSERT_TOOL_FQN, REPLACE_TOOL_FQN, SET_LANGUAGE_TOOL_FQN]),
                  ...(hasReadableContext ? READ_ONLY_TOOLS : []),
                ]),
      ],
      canUseTool,
      abortController: controller,
      // Forward sub-agent (Task) text and thinking with `parent_tool_use_id` set, so the renderer can
      // show nested sub-agent activity as live progress instead of an opaque "Working…" stall.
      forwardSubagentText: true,
      // Resume the conversation's prior session when one exists, so the model keeps the earlier turns'
      // context (the SDK replays the persisted session transcript, including tool calls and results).
      // Absent on a conversation's first turn, which starts a fresh session. A branch (rewind)
      // resumes only up to its anchor message and forks to a new session id, so the discarded turns
      // never reach the model and the original session stays resumable.
      ...(openContext.resumeSessionId !== null ? { resume: openContext.resumeSessionId } : {}),
      ...(openContext.resumeSessionId !== null && openContext.resumeSessionAt !== null
        ? { resumeSessionAt: openContext.resumeSessionAt }
        : {}),
      ...(openContext.resumeSessionId !== null && openContext.forkSession
        ? { forkSession: true }
        : {}),
      // Cap the turn's token budget when the user set one; the SDK sends it as the API-side task
      // budget so the model paces its tool use and wraps up before the limit. Frozen at open — a
      // per-turn cap change lands with the session-lifetime work (P4).
      ...(openContext.tokenCap > 0 ? { taskBudget: { total: openContext.tokenCap } } : {}),
      ...this.executableOption(openContext.claudeExecutable),
      ...(this.runEnv(openContext) ?? {}),
    };

    return options;
  }

  /**
   * Runs a single turn through the Agent SDK, streaming reasoning, text, and tool activity. A transient
   * run: opens a live session, runs this one turn into it, then closes it — behaviour identical to the
   * old single-shot run. The persistent path (holding the session open across turns, #327) drives the
   * same {@link ClaudeAgentSession} through {@link openSession}/{@link AgentSession.turn} instead.
   * @param context The run context.
   */
  public async run(context: AgentRunContext): Promise<void> {
    const session: ClaudeAgentSession = this.openSession(context);
    try {
      await session.turn(context);
    } finally {
      await session.close();
    }
  }

  /**
   * Opens a live Claude session for one agent (#324/#327): it holds the SDK query open and runs each
   * {@link AgentSession.turn} into it. The session builds its options from the opening context and
   * translates the SDK stream through this provider's message handlers.
   * @param context The context of the turn the session opens for.
   * @returns Returns the live session.
   */
  public openSession(context: AgentRunContext): ClaudeAgentSession {
    return new ClaudeAgentSession(
      {
        buildRunOptions: (
          getContext: () => AgentRunContext,
          controller: AbortController,
        ): Promise<Options> => this.buildRunOptions(getContext, controller),
        createQuery: async (
          prompt: AsyncGenerator<SDKUserMessage>,
          options: Options,
        ): Promise<Query> => {
          const { query } = await import('@anthropic-ai/claude-agent-sdk');
          return query({ prompt, options });
        },
        handleMessage: (
          message: SDKMessage,
          ctx: AgentRunContext,
          usageState: RunUsageState,
        ): void => this.handleMessage(message, ctx, usageState),
        sessionIdOf: (message: SDKMessage): string | null => this.sessionIdOf(message),
      },
      context,
    );
  }

  /**
   * Reads the session id an SDK message carries, or null when the message has none.
   * @param message The SDK message.
   * @returns Returns the session id, or null.
   */
  private sessionIdOf(message: SDKMessage): string | null {
    const value: unknown = (message as { session_id?: unknown }).session_id;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /**
   * Builds the system-prompt appendix for a run: the surface-specific guidance, plus the read-only note
   * on a chat-mode run.
   * @param surface The surface the run acts on.
   * @param readOnly Whether the run is read-only (chat mode).
   * @returns Returns the combined appendix.
   */
  private systemAppendix(surface: AgentSurface, readOnly: boolean): string {
    const base: string =
      surface === 'terminal'
        ? TERMINAL_PROMPT_APPENDIX
        : surface === 'binary'
          ? BINARY_PROMPT_APPENDIX
          : surface === 'project'
            ? PROJECT_PROMPT_APPENDIX
            : STUDIO_PROMPT_APPENDIX;
    // Every surface learns it can ask the user questions instead of guessing.
    const withAsk: string = `${base}\n\n${ASK_USER_PROMPT_APPENDIX}`;
    if (readOnly) {
      return `${withAsk}\n\n${READ_ONLY_APPENDIX}`;
    }
    // The run-configuration tools are registered on the workspace-scoped surfaces only, so only those
    // are told how to author them (see the tool registration in `buildRunOptions`).
    return surface === 'terminal' || surface === 'binary'
      ? withAsk
      : `${withAsk}\n\n${RUN_CONFIGURATION_PROMPT_APPENDIX}`;
  }

  /**
   * Builds the `pathToClaudeCodeExecutable` option in a packaged build, where the Agent SDK's own
   * resolution points inside `app.asar` and cannot spawn the bundled CLI. In development it returns an
   * empty object so the SDK resolves the binary itself.
   * @returns Returns `{ pathToClaudeCodeExecutable }` when packaged and the binary is present, else `{}`.
   */
  private executableOption(
    choice: ClaudeExecutableChoice | undefined,
  ): { pathToClaudeCodeExecutable: string } | Record<string, never> {
    const executable: string | undefined = resolveClaudeExecutable(choice);
    return executable === undefined ? {} : { pathToClaudeCodeExecutable: executable };
  }

  /**
   * Lists the models the Claude Agent SDK reports for the current login, over a short-lived query's
   * control channel — no turn is sent and no API key is needed, so this works for the local-login
   * connection that has no key to drive the HTTP `/v1/models` discovery. The query factory is injected
   * for testing; production imports the SDK's `query`.
   * @param executable The Claude CLI to spawn (bundled by default).
   * @param createQuery Creates the SDK query (defaults to the real SDK).
   * @returns Returns the models the SDK supports.
   */
  public async listSupportedModels(
    executable: ClaudeExecutableChoice | undefined,
    createQuery: ClaudeQueryFactory = defaultClaudeQueryFactory,
  ): Promise<readonly ClaudeSdkModel[]> {
    const options: Options = { ...this.executableOption(executable) };
    let release: () => void = (): void => undefined;
    // The SDK's streaming-input mode keeps the session open until the prompt generator completes; it
    // yields nothing (discovery sends no turn) and returns once discovery is done.
    const released: Promise<void> = new Promise<void>((resolve: () => void): void => {
      release = resolve;
    });
    async function* keepOpen(): AsyncGenerator<SDKUserMessage> {
      await released;
      // Discovery sends no turn; complete without yielding once discovery finishes.
      yield* [];
    }
    const sdkQuery: Query = await createQuery(keepOpen(), options);
    try {
      const models: readonly ModelInfo[] = await sdkQuery.supportedModels();
      return models.map(
        (model: ModelInfo): ClaudeSdkModel => ({
          value: model.value,
          displayName: model.displayName,
          resolvedModel: (model as { readonly resolvedModel?: string }).resolvedModel,
          description: model.description,
        }),
      );
    } finally {
      release();
      try {
        await sdkQuery.interrupt();
      } catch {
        // Best-effort teardown of the short-lived discovery query.
      }
    }
  }

  /**
   * Builds the `env` option for the run, or null to leave the SDK to inherit `process.env` (already
   * hydrated from the default login shell at startup, #317). An explicit env is built when either an
   * API key must be injected, or the user chose a specific agent shell (#318) whose profile
   * environment overlays the process env — its exports and `PATH` take effect, and `SHELL` is set to
   * the chosen shell. A failed capture leaves the inherited env in place (fail-open).
   * @param context The run context (its credential material and configured agent shell).
   * @returns Returns `{ env }`, or null to leave the environment untouched.
   */
  private runEnv(context: AgentRunContext): { env: Record<string, string> } | null {
    const auth: AgentAuth = context.auth;
    const usingApiKey: boolean = !auth.hasLocalLogin && auth.apiKey !== null;
    const shell: string | null = context.agentShell;
    const useShell: boolean = typeof shell === 'string' && shell.length > 0;
    if (!usingApiKey && !useShell) {
      return null;
    }

    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        env[name] = value;
      }
    }

    // Overlay the chosen shell's profile: unlike the startup hydrate (which only fills gaps), this is
    // an explicit per-agent choice, so the shell's exports override the inherited env and its PATH is
    // merged to the front.
    if (useShell && shell !== null) {
      const captured: Record<string, string> | null = captureShellEnvironmentCached(shell);
      if (captured !== null) {
        Object.assign(env, applyCapturedEnvironment(env, captured, true));
      }
      env['SHELL'] = shell;
    }

    if (usingApiKey && auth.apiKey !== null) {
      env['ANTHROPIC_API_KEY'] = auth.apiKey;
    }
    return { env };
  }

  /**
   * Translates an SDK message into transcript events: reasoning, assistant text, and tool lifecycle.
   * Messages produced inside a sub-agent (Task) carry `parent_tool_use_id`; their events carry it as
   * `parentToolId` so the renderer nests them under the spawning tool use.
   * @param message The SDK message.
   * @param context The run context to emit through.
   * @param usageState Tracks the last cumulative cost and the last top-level assistant usage across the
   * run's turns, so a steered run's several results each report only their turn's cost delta and the
   * context meter reads the final round-trip's true occupancy.
   */
  private handleMessage(
    message: SDKMessage,
    context: AgentRunContext,
    usageState: RunUsageState,
  ): void {
    const parent: string | null = this.parentToolIdOf(message);
    if (message.type === 'assistant') {
      const uuid: unknown = (message as { uuid?: unknown }).uuid;
      this.handleAssistantBlocks(
        message.message.content as readonly ContentBlock[],
        context,
        parent,
        typeof uuid === 'string' && uuid.length > 0 ? uuid : null,
      );
      this.handleSubagentUsage(message, context, parent);
      // A top-level assistant message's usage is a true snapshot of the context at that round-trip;
      // keep the latest so the terminal result can report it as the window occupancy.
      if (parent === null) {
        const usage: SdkTokenUsage | undefined = this.usageOf(message);
        if (usage !== undefined) {
          usageState.lastAssistantUsage = usage;
        }
      }
    } else if (message.type === 'user') {
      this.handleToolResults(message, context, parent);
    } else if (message.type === 'result') {
      this.handleResult(message, context, usageState);
    }
  }

  /**
   * Reads the sub-agent attribution an SDK message carries: the id of the Task tool use it belongs
   * to, or null for a top-level message.
   * @param message The SDK message.
   * @returns Returns the parent tool use id, or null.
   */
  private parentToolIdOf(message: SDKMessage): string | null {
    const value: unknown = (message as { parent_tool_use_id?: unknown }).parent_tool_use_id;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /**
   * Emits a sub-agent usage event from an assistant message produced inside a Task, so the renderer
   * can attribute tokens to that sub-agent's lane. Only sub-agent messages are reported this way — the
   * run's own context occupancy is tracked separately from its top-level assistant messages (see
   * {@link handleMessage}), so the context meter never folds in a sub-agent's separate window.
   * @param message The assistant SDK message.
   * @param context The run context to emit through.
   * @param parent The sub-agent (Task tool use) the message belongs to, or null for top-level.
   */
  private handleSubagentUsage(
    message: SDKMessage,
    context: AgentRunContext,
    parent: string | null,
  ): void {
    if (parent === null) {
      return;
    }
    const usage: SdkTokenUsage | undefined = this.usageOf(message);
    if (usage === undefined) {
      return;
    }
    context.emit({
      requestId: context.requestId,
      kind: 'usage',
      parentToolId: parent,
      inputTokens: this.contextInputOf(usage),
      outputTokens: usage.output_tokens ?? 0,
      costUsd: null,
    });
  }

  /**
   * Reads the token usage an assistant SDK message carries, or undefined when it has none.
   * @param message The SDK message.
   * @returns Returns the message's usage, or undefined.
   */
  private usageOf(message: SDKMessage): SdkTokenUsage | undefined {
    return (message as { message?: { usage?: SdkTokenUsage } }).message?.usage;
  }

  /**
   * Sums the input side of a usage snapshot: fresh input plus the cached and cache-creation tokens —
   * the whole context the model processed at that round-trip. This is the figure that reflects context
   * occupancy.
   * @param usage The usage snapshot.
   * @returns Returns the total input (context) tokens.
   */
  private contextInputOf(usage: SdkTokenUsage): number {
    return (
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0)
    );
  }

  /**
   * Emits the terminal `result` message's usage: this turn's cost delta, and the context-window
   * occupancy for the meter.
   *
   * The result's own `usage` is the turn's CUMULATIVE billing total, summed across every internal model
   * round-trip in the agentic loop. Each round-trip re-reads the growing conversation as cached input,
   * so a tool-heavy turn (many round-trips) sums those re-reads into a figure many times the true
   * context size — the meter would show near-full for a small conversation. Cost accumulates the same
   * way, and there accumulation is correct. So: cost comes from `result.total_cost_usd`, but the context
   * meter is fed the LAST top-level assistant message's usage — a true snapshot of the window at the
   * final round-trip. (Falls back to the result aggregate only when the turn produced no assistant
   * message, a degenerate case where the aggregate is not inflated.)
   * @param message The result SDK message.
   * @param context The run context to emit through.
   * @param usageState Tracks the last cumulative cost and the last top-level assistant usage.
   */
  private handleResult(
    message: SDKMessage,
    context: AgentRunContext,
    usageState: RunUsageState,
  ): void {
    const result: { usage?: SdkTokenUsage; total_cost_usd?: number } = message as never;
    // Context occupancy is a snapshot, not an accumulation: read the final round-trip's usage, not the
    // turn's summed-across-round-trips result aggregate.
    const occupancy: SdkTokenUsage | undefined = usageState.lastAssistantUsage ?? result.usage;
    if (occupancy === undefined) {
      return;
    }
    // The reported cost is cumulative across the run's turns; emit this turn's delta so the
    // renderer's accumulating readout never double-counts a steered run.
    let costUsd: number | null = null;
    if (typeof result.total_cost_usd === 'number') {
      costUsd =
        result.total_cost_usd >= usageState.lastCostUsd
          ? result.total_cost_usd - usageState.lastCostUsd
          : result.total_cost_usd;
      usageState.lastCostUsd = result.total_cost_usd;
    }
    context.emit({
      requestId: context.requestId,
      kind: 'usage',
      inputTokens: this.contextInputOf(occupancy),
      outputTokens: occupancy.output_tokens ?? 0,
      costUsd,
    });
  }

  /**
   * Emits reasoning, text, and tool-start events for an assistant message's content blocks. A Task
   * tool use additionally carries its `subagent_type` so the renderer labels the sub-agent's lane.
   * @param blocks The assistant content blocks.
   * @param context The run context to emit through.
   * @param parent The sub-agent (Task tool use) the message belongs to, or null for top-level.
   * @param uuid The SDK message uuid text chunks carry (the branch anchor), or null when absent.
   */
  private handleAssistantBlocks(
    blocks: readonly ContentBlock[],
    context: AgentRunContext,
    parent: string | null,
    uuid: string | null,
  ): void {
    const attribution: { parentToolId?: string } = parent === null ? {} : { parentToolId: parent };
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        context.emit({
          requestId: context.requestId,
          kind: 'text',
          delta: block.text,
          ...(uuid === null ? {} : { messageUuid: uuid }),
          ...attribution,
        });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        context.emit({
          requestId: context.requestId,
          kind: 'thinking',
          delta: block.thinking,
          ...attribution,
        });
      } else if (block.type === 'tool_use' && typeof block.id === 'string') {
        const agentType: unknown = block.input?.['subagent_type'];
        const input: string | undefined = formatToolInput(block.input);
        context.emit({
          requestId: context.requestId,
          kind: 'tool-start',
          toolId: block.id,
          name: prettyToolName(block.name ?? 'tool'),
          detail: summarizeToolInput(block.input),
          ...(input === undefined ? {} : { input }),
          ...attribution,
          ...(typeof agentType === 'string' && agentType.length > 0 ? { agentType } : {}),
        });
      }
    }
  }

  /**
   * Emits tool-end events for the tool-result blocks carried by a user message.
   * @param message The user SDK message.
   * @param context The run context to emit through.
   * @param parent The sub-agent (Task tool use) the message belongs to, or null for top-level.
   */
  private handleToolResults(
    message: SDKMessage,
    context: AgentRunContext,
    parent: string | null,
  ): void {
    const content: unknown = (message as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) {
      return;
    }
    for (const block of content as readonly ContentBlock[]) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const output: string | undefined = formatToolOutput(block.content);
        context.emit({
          requestId: context.requestId,
          kind: 'tool-end',
          toolId: block.tool_use_id,
          ok: block.is_error !== true,
          detail: block.is_error === true ? 'failed' : 'done',
          ...(output === undefined ? {} : { output }),
          ...(parent === null ? {} : { parentToolId: parent }),
        });
      }
    }
  }
}

/**
 * Builds a plain-text user message for the streaming input.
 * @param value The message text.
 * @returns Returns the SDK user message.
 */
function userMessageOf(value: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: value }, parent_tool_use_id: null };
}

/**
 * Creates a Claude Agent SDK query. Injected so model discovery (and runs) can be tested without
 * spawning the harness.
 */
type ClaudeQueryFactory = (
  prompt: AsyncGenerator<SDKUserMessage>,
  options: Options,
) => Promise<Query>;

/**
 * The production query factory: dynamically imports the SDK's `query` so the heavy SDK loads only when
 * a run or discovery actually needs it.
 * @param prompt The streaming-input prompt generator.
 * @param options The query options.
 * @returns Returns the SDK query.
 */
const defaultClaudeQueryFactory: ClaudeQueryFactory = async (
  prompt: AsyncGenerator<SDKUserMessage>,
  options: Options,
): Promise<Query> => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  return query({ prompt, options });
};

/**
 * The provider capabilities a {@link ClaudeAgentSession} borrows: building the run options, translating
 * SDK messages into events, and reading the session id a message carries. Passed as bound callbacks so
 * the session reuses the provider's logic without depending on its private members.
 */
export interface SessionDeps {
  /**
   * Builds the SDK options for the session's query, wired to the given abort controller. Takes a
   * context accessor rather than a snapshot so the built-in per-turn closures (tool handlers, the
   * permission gate, the audit hook) follow the session's current turn across a held-open query.
   */
  buildRunOptions(getContext: () => AgentRunContext, controller: AbortController): Promise<Options>;

  /**
   * Opens the SDK query for the session's streaming input and built options. Isolated as a dep so the
   * session holds no direct SDK import — the provider supplies the real `query()`, tests a fake.
   */
  createQuery(prompt: AsyncGenerator<SDKUserMessage>, options: Options): Promise<Query>;

  /**
   * Translates one SDK message into streamed events through the given context.
   */
  handleMessage(message: SDKMessage, context: AgentRunContext, usageState: RunUsageState): void;

  /**
   * Reads the session id an SDK message carries, or null when it has none.
   */
  sessionIdOf(message: SDKMessage): string | null;
}

/**
 * A live Claude Agent SDK session for one agent (#324/#327): it holds a single `query()` open across
 * turns via the SDK's streaming-input mode, so a conversation keeps its context in-process instead of
 * re-resuming a persisted session every turn. Each {@link turn} pushes a user message into the open
 * input and settles when that turn's `result` arrives, leaving the query open for the next turn;
 * {@link interrupt} stops the current turn but keeps the session; {@link close} ends it and terminates
 * the subprocess.
 *
 * The query is opened lazily on the first turn. The structural options (cwd, the MCP tool set, allowed/
 * disallowed tools, sandbox, system prompt, resume, env) are built once at open from the opening turn's
 * context; the per-turn tool/gate/audit closures read the session's current turn context each
 * invocation (see {@link ClaudeAgentProvider.buildRunOptions}), so a held-open session follows each
 * turn's permission gate, audit sink, request id, and bridge. A later turn that changes the model
 * applies it live via `Query.setModel`; a later turn that changes a frozen structural field is not
 * continued here — the live-session router reopens the session (`AiManager.isCompatibleTurn`).
 */
export class ClaudeAgentSession implements AgentSession {
  /**
   * The context of the turn currently in flight; swapped on each {@link turn} so the message pump emits
   * through the active turn.
   */
  private currentContext: AgentRunContext;

  /**
   * The model currently bound to the query: set to the opening turn's model, then updated whenever a
   * later turn changes it (applied live via `Query.setModel`, since the options' model is bound at
   * open). Null before the first turn opens the query.
   */
  private appliedModel: string | null = null;

  /**
   * The open SDK query, or null before the first turn opens it.
   */
  private sdkQuery: Query | null = null;

  /**
   * The session's master abort controller: aborting it terminates the query and its subprocess. Created
   * at open; fired by {@link close}.
   */
  private controller: AbortController | null = null;

  /**
   * Messages queued for the streaming input: the turn's initial message and any steered follow-ups.
   */
  private readonly pendingMessages: SDKUserMessage[] = [];

  /**
   * Resolves the promptStream's park when a message is queued or the input closes, or null when the
   * stream is not parked.
   */
  private wake: (() => void) | null = null;

  /**
   * Whether the streaming input has been closed (the session is ending).
   */
  private inputClosed: boolean = false;

  /**
   * The last SDK session id reported to the renderer, so it is emitted once (and again if it changes).
   */
  private reportedSessionId: string | null = null;

  /**
   * Usage state spanning the session's turns: the last cumulative cost (so each turn reports its delta)
   * and the last top-level assistant usage (the true context occupancy).
   */
  private readonly usageState: RunUsageState = { lastCostUsd: 0, lastAssistantUsage: null };

  /**
   * The running message pump, awaited by {@link close} so teardown waits for it to finish.
   */
  private pumpDone: Promise<void> | null = null;

  /**
   * Settles the in-flight turn's promise (a `result` arrived or the session closed), or null when no
   * turn is awaiting.
   */
  private turnSettle: (() => void) | null = null;

  /**
   * Rejects the in-flight turn's promise on an unexpected stream error, or null when no turn is
   * awaiting.
   */
  private turnReject: ((reason: unknown) => void) | null = null;

  /**
   * Whether {@link close} has run (idempotent teardown).
   */
  private closed: boolean = false;

  /**
   * Initialises a new instance of the {@link ClaudeAgentSession} class.
   * @param deps The provider capabilities the session borrows.
   * @param initialContext The context of the turn the session opens for.
   */
  public constructor(
    private readonly deps: SessionDeps,
    initialContext: AgentRunContext,
  ) {
    this.currentContext = initialContext;
  }

  /**
   * Gets the SDK session id once a turn has reported it, or null before.
   */
  public get id(): string | null {
    return this.reportedSessionId;
  }

  /**
   * Runs a turn in this session, streaming its events through the context and settling when the turn's
   * `result` arrives — leaving the session open for the next turn. Opens the query lazily on the first
   * turn.
   * @param context The turn's context.
   */
  public async turn(context: AgentRunContext): Promise<void> {
    this.currentContext = context;
    if (this.sdkQuery === null) {
      await this.openInternal();
      this.appliedModel = context.model;
    } else if (context.model !== this.appliedModel) {
      // A later turn changed the model: apply it live, since the query's model was bound at open.
      this.appliedModel = context.model;
      void this.sdkQuery.setModel(context.model);
    }
    // Register this turn's steer handler so a mid-turn injected message becomes a follow-up input.
    context.setSteerHandler((steered: string): boolean => {
      if (this.inputClosed) {
        return false;
      }
      this.pendingMessages.push(userMessageOf(steered));
      this.wake?.();
      return true;
    });
    // Aborting the turn's signal (the Stop button, a timeout) interrupts the current turn but keeps the
    // session live for the next turn (Decision 4). The session is torn down only by {@link close} (New
    // chat / tab close / shutdown), never by a per-turn abort.
    const onAbort: () => void = (): void => this.interrupt();
    context.signal.addEventListener('abort', onAbort, { once: true });
    this.pendingMessages.push(this.buildTurnMessage(context));
    this.wake?.();
    return new Promise<void>((resolve: () => void, reject: (reason: unknown) => void): void => {
      this.turnSettle = (): void => {
        context.signal.removeEventListener('abort', onAbort);
        resolve();
      };
      this.turnReject = (reason: unknown): void => {
        context.signal.removeEventListener('abort', onAbort);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      };
    });
  }

  /**
   * Interrupts the in-flight turn, leaving the session open for the next turn. The SDK ends the turn and
   * emits a `result` for it, which the pump uses to settle the turn; the `.then`/`.catch` is a safety
   * net that settles the turn once the interrupt has completed even if the SDK produced no result — at
   * which point the query is idle awaiting the next input, so settling cannot interleave with a live
   * turn. A no-op before the query has opened.
   */
  public interrupt(): void {
    const query: Query | null = this.sdkQuery;
    if (query === null) {
      return;
    }
    void query
      .interrupt()
      .then((): void => this.settleTurn())
      .catch((): void => this.settleTurn());
  }

  /**
   * Ends the session: closes the input, terminates the query and its subprocess, and waits for the pump
   * to finish. Idempotent.
   */
  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.inputClosed = true;
    this.currentContext.setSteerHandler(null);
    this.controller?.abort();
    this.wake?.();
    // The pump's failure (if any) is surfaced through the in-flight turn; teardown ignores it.
    await this.pumpDone?.catch((): undefined => undefined);
  }

  /**
   * Opens the SDK query lazily on the first turn, building the options from that turn's context and
   * starting the message pump.
   * @param context The opening turn's context.
   */
  private async openInternal(): Promise<void> {
    this.controller = new AbortController();
    // Pass a live accessor, not a snapshot: the per-turn tool/gate/audit closures resolve the session's
    // current turn context each invocation (`turn()` swaps it), while the frozen structural options read
    // it once, at open.
    const options: Options = await this.deps.buildRunOptions(
      (): AgentRunContext => this.currentContext,
      this.controller,
    );
    this.sdkQuery = await this.deps.createQuery(this.promptStream(), options);
    this.pumpDone = this.pump();
    // Discover the session's slash commands once it is open (#330); refreshed later by the
    // `commands_changed` push handled in the pump. Best-effort — a failure never disturbs the run.
    void this.emitCommands();
  }

  /**
   * Fetches the session's current slash commands from the live query and publishes them to the renderer.
   * Best-effort: any failure (e.g. the query not supporting the control request) is swallowed.
   */
  private async emitCommands(): Promise<void> {
    const query: Query | null = this.sdkQuery;
    if (query === null) {
      return;
    }
    try {
      this.publishCommands(await query.supportedCommands());
    } catch {
      // Command discovery is best-effort; never let it disturb the session.
    }
  }

  /**
   * Publishes a discovered command set to the renderer through the current turn's context.
   * @param commands The SDK slash commands.
   */
  private publishCommands(commands: readonly SlashCommand[]): void {
    // Diagnostic (#330): surface what the SDK actually reports, so a missing command can be told apart
    // from a discovery/routing problem. Visible in the terminal running the app.
    console.log(
      `[claude] discovered ${commands.length} slash command(s): ${commands
        .map((command: SlashCommand): string => command.name)
        .join(', ')}`,
    );
    this.currentContext.emit({
      requestId: this.currentContext.requestId,
      kind: 'commands',
      agentSessionId: this.currentContext.agentSessionId,
      commands: commands.map(
        (command: SlashCommand): { name: string; description: string; argumentHint: string } => ({
          name: command.name,
          description: command.description,
          argumentHint: command.argumentHint,
        }),
      ),
    });
  }

  /**
   * The streaming-input generator: yields queued messages, then parks until the next message is queued
   * or the input closes.
   * @returns Yields the session's user messages.
   */
  private async *promptStream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const next: SDKUserMessage | undefined = this.pendingMessages.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.inputClosed) {
        return;
      }
      await new Promise<void>((resolve: () => void): void => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }

  /**
   * Consumes the SDK message stream for the session's life, emitting the session id once and
   * translating each message through the provider's handlers. Unlike the old run loop it does NOT break
   * on `result`: a `result` (with nothing further queued) settles the in-flight turn but leaves the
   * stream open for the next turn. The stream ends only when the input closes (via {@link close}).
   */
  private async pump(): Promise<void> {
    if (this.sdkQuery === null) {
      return;
    }
    try {
      for await (const message of this.sdkQuery) {
        const sessionId: string | null = this.deps.sessionIdOf(message);
        if (sessionId !== null && sessionId !== this.reportedSessionId) {
          this.reportedSessionId = sessionId;
          this.currentContext.emit({
            requestId: this.currentContext.requestId,
            kind: 'session',
            sessionId,
          });
        }
        // A mid-session command-list change (e.g. skills discovered as the agent works): replace the
        // cached set (#330). `supportedCommands()` is captured once at init and never reflects these,
        // so the push is the only live signal.
        const changed: { type?: string; subtype?: string; commands?: SlashCommand[] } = message;
        if (
          changed.type === 'system' &&
          changed.subtype === 'commands_changed' &&
          Array.isArray(changed.commands)
        ) {
          this.publishCommands(changed.commands);
        }
        this.deps.handleMessage(message, this.currentContext, this.usageState);
        // A turn's `result` settles that turn but leaves the stream open for the next turn; an
        // interrupted turn arrives here too (the SDK emits a `result` for it). The stream itself ends
        // only when the input closes (via {@link close}), never on a per-turn abort — so a Stop
        // interrupts the turn without ending the session.
        if (message.type === 'result' && this.pendingMessages.length === 0) {
          this.settleTurn();
        }
      }
    } catch (error: unknown) {
      // A deliberate teardown ({@link close} aborted the master controller) ends any in-flight turn as
      // settled; any other stream error rejects the in-flight turn so the manager lands it as an error
      // (and evicts the now-dead session so the next turn opens fresh).
      if (this.closed) {
        this.settleTurn();
      } else {
        this.rejectTurn(error);
      }
    } finally {
      // The stream has ended: the session cannot take another turn. Mark the input closed so a stray
      // later turn() does not park forever waiting on a pump that has exited.
      this.inputClosed = true;
      this.settleTurn();
    }
  }

  /**
   * Settles the in-flight turn's promise, if any.
   */
  private settleTurn(): void {
    const settle: (() => void) | null = this.turnSettle;
    this.turnSettle = null;
    this.turnReject = null;
    settle?.();
  }

  /**
   * Rejects the in-flight turn's promise, if any.
   * @param reason The failure reason.
   */
  private rejectTurn(reason: unknown): void {
    const reject: ((reason: unknown) => void) | null = this.turnReject;
    this.turnSettle = null;
    this.turnReject = null;
    reject?.(reason);
  }

  /**
   * Builds a turn's initial user message: the prompt text, with any attached images as image blocks
   * ahead of the text (steered follow-ups are text-only).
   * @param context The turn's context.
   * @returns Returns the SDK user message.
   */
  private buildTurnMessage(context: AgentRunContext): SDKUserMessage {
    const prompt: string = buildRunPrompt(context);
    if (context.images.length === 0) {
      return userMessageOf(prompt);
    }
    return {
      type: 'user',
      message: {
        role: 'user',
        content: [
          ...context.images.map(
            (
              image: AiImageRef,
            ): {
              type: 'image';
              source: { type: 'base64'; media_type: string; data: string };
            } => ({
              type: 'image',
              source: { type: 'base64', media_type: image.mediaType, data: image.data },
            }),
          ),
          { type: 'text', text: prompt },
        ],
      } as SDKUserMessage['message'],
      parent_tool_use_id: null,
    };
  }
}
