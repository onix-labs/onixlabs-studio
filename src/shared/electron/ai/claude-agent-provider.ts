import { ChildProcess, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, isAbsolute } from 'node:path';
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
  SDKTaskNotificationMessage,
  SandboxSettings,
  SDKUserMessage,
  SlashCommand,
  SpawnedProcess,
  SpawnOptions as SdkSpawnOptions,
} from '@anthropic-ai/claude-agent-sdk';
import { expandNetworkLocations } from '@shared/api/network-locations';
import { logger } from '../logger';
import { pidJournal } from '../pid-journal';
import { detachedSpawnOptions, killProcessTree, signalProcessTree } from '../process-tree';
import {
  DELETE_RUN_CONFIGURATIONS,
  CREATE_API_REQUEST,
  LIST_API_REQUESTS,
  LIST_RUN_CONFIGURATIONS,
  SEND_API_REQUEST,
  SET_API_VARIABLE,
  UPDATE_API_REQUEST,
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
  OPEN_DOCUMENT,
  OPEN_TERMINAL,
  READ_TERMINAL_OUTPUT,
  REPLACE_ACTIVE_DOCUMENT,
  RUN_ACTIVE_DOCUMENT,
  SAVE_DOCUMENT,
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
import { RemoteControlBridge } from './claude-remote-control';
import {
  applyCapturedEnvironment,
  captureShellEnvironmentCached,
} from '@shared/electron/shell-env';
import {
  CLARIFYING_QUESTION_APPENDIX,
  API_PROMPT_APPENDIX,
  BINARY_PROMPT_APPENDIX,
  createApiRequest,
  listApiRequests,
  sendApiRequest,
  setApiVariable,
  updateApiRequest,
  EDIT_TOOL_FQN,
  INSERT_TOOL_FQN,
  PROJECT_PROMPT_APPENDIX,
  RUN_CONFIGURATION_PROMPT_APPENDIX,
  LIST_API_REQUESTS_FQN,
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
  WORKBENCH_PROMPT_APPENDIX,
  OPEN_DOCUMENT_FQN,
  SAVE_DOCUMENT_FQN,
  OPEN_TERMINAL_FQN,
  openDocument,
  saveDocument,
  openTerminal,
  WRITE_TERMINAL_FQN,
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
 * The SDK's built-in clarifying-question tool. It reaches `canUseTool` (even under an allow rule) and is
 * answered by returning `{behavior:'allow', updatedInput:{questions, answers}}`; Studio renders it
 * locally and forwards it to claude.ai under remote control (#331).
 */
const ASK_USER_QUESTION_TOOL: string = 'AskUserQuestion';

/**
 * One suggested answer to an {@link AskUserQuestionQuestion}: a short label and an optional explanation.
 */
interface AskUserQuestionOption {
  readonly label: string;
  readonly description?: string;
}

/**
 * One question from an `AskUserQuestion` tool call, reduced to what Studio's input-request UI renders.
 */
interface AskUserQuestionQuestion {
  readonly question: string;
  readonly options: readonly AskUserQuestionOption[];
}

/**
 * Parses the `questions` array from an `AskUserQuestion` tool input into the questions Studio renders,
 * defensively — malformed entries (missing text, non-object options) are skipped.
 * @param input The `AskUserQuestion` tool input.
 * @returns Returns the parsed questions (empty when none are usable).
 */
function parseAskUserQuestions(input: Record<string, unknown>): readonly AskUserQuestionQuestion[] {
  const raw: unknown = input['questions'];
  if (!Array.isArray(raw)) {
    return [];
  }
  const questions: AskUserQuestionQuestion[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const record: Record<string, unknown> = item as Record<string, unknown>;
    const question: unknown = record['question'];
    if (typeof question !== 'string' || question.length === 0) {
      continue;
    }
    const options: AskUserQuestionOption[] = [];
    const optionsRaw: unknown = record['options'];
    if (Array.isArray(optionsRaw)) {
      for (const opt of optionsRaw) {
        if (opt === null || typeof opt !== 'object') {
          continue;
        }
        const o: Record<string, unknown> = opt as Record<string, unknown>;
        const label: unknown = o['label'];
        if (typeof label !== 'string' || label.length === 0) {
          continue;
        }
        const description: unknown = o['description'];
        options.push({
          label,
          ...(typeof description === 'string' ? { description } : {}),
        });
      }
    }
    questions.push({ question, options });
  }
  return questions;
}

/**
 * Holds the built-in file-editing tools auto-allowed under the `auto-edits` permission posture.
 */
const EDIT_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/**
 * Holds the tools a terminal-surface run may reach: its own two terminal tools, plus the workbench
 * tools every surface carries. The confinement exists to stop a terminal-docked agent acting on the
 * file system or on another view's document; opening a tab of its own does neither.
 */
const TERMINAL_SURFACE_TOOLS: readonly string[] = [
  READ_TERMINAL_FQN,
  WRITE_TERMINAL_FQN,
  OPEN_DOCUMENT_FQN,
  SAVE_DOCUMENT_FQN,
  OPEN_TERMINAL_FQN,
];

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
 * Builds the SDK option that puts the Claude CLI's spawning under this application's process
 * lifecycle management. The CLI is spawned as its own process-group leader and recorded in the pid
 * journal, so (a) ending the session ends the CLI's whole tool subtree — a Bash tool mid-`dotnet
 * build` must not keep building headless — and (b) a force-killed application's surviving CLIs are
 * reaped at the next startup. The SDK's own kill and its post-grace abort are both redirected at the
 * group rather than the single pid.
 * @returns Returns the `spawnClaudeCodeProcess` option fragment.
 */
function managedSpawnerOption(): Pick<Options, 'spawnClaudeCodeProcess'> {
  return {
    spawnClaudeCodeProcess: (spawnOptions: SdkSpawnOptions): SpawnedProcess => {
      const child: ChildProcess = spawn(spawnOptions.command, spawnOptions.args, {
        cwd: spawnOptions.cwd,
        env: spawnOptions.env,
        // The SDK reads only the interface's stdin/stdout; stderr has no reader here, so it must not
        // be a pipe that could fill and stall the CLI.
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
        ...detachedSpawnOptions(),
      });
      pidJournal()?.register(child.pid, 'agent', spawnOptions.command);
      child.once('exit', (): void => pidJournal()?.unregister(child.pid));
      // The forwarded signal fires only after the SDK's stdin-EOF grace window: the CLI had its
      // chance to exit cleanly, so end the whole tree.
      spawnOptions.signal.addEventListener('abort', (): void => {
        if (child.pid !== undefined) {
          killProcessTree(child.pid);
        }
      });
      return {
        stdin: child.stdin!,
        stdout: child.stdout!,
        get killed(): boolean {
          return child.killed;
        },
        get exitCode(): number | null {
          return child.exitCode;
        },
        kill: (signal: NodeJS.Signals): boolean => {
          if (child.pid === undefined) {
            return false;
          }
          signalProcessTree(child.pid, signal);
          return true;
        },
        on: child.on.bind(child),
        once: child.once.bind(child),
        off: child.off.bind(child),
      };
    },
  };
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
   * The Claude Code harness has a native Remote Control feature (claude.ai/code), which Studio drives
   * through the harness's own settings rather than wiring the bridge itself (#331).
   */
  public readonly supportsRemoteControl: boolean = true;

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
    logger.info(
      'ClaudeAgentProvider',
      `Provider created with ${models.length} model(s), default '${defaultModelId}'`,
    );
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
    getBridge: () => RemoteControlBridge | null,
  ): Promise<Options> {
    const { tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
    const { z } = await import('zod');
    // The context the session opens with; the frozen structural options below read it once.
    const openContext: AgentRunContext = getContext();
    const hasWorkspace: boolean = openContext.workspaceRoot !== null;
    const surface: AgentSurface = openContext.surface;
    const terminal: boolean = surface === 'terminal';
    const binary: boolean = surface === 'binary';
    // An API Explorer run acts on that tab's collections through the API tools, and on nothing else.
    const api: boolean = surface === 'api';
    // The standalone agent tab has no owning document: beyond the ask-user tool, no in-app studio
    // tools are registered, and the run works through the SDK's built-in tools alone (gated by the
    // permission posture as usual).
    const project: boolean = surface === 'project';
    logger.trace(
      'ClaudeAgentProvider.buildRunOptions',
      `Building run options: surface=${surface}, mode=${openContext.mode}, model=${openContext.model}, workspace=${hasWorkspace}`,
    );
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
    // `AskUserQuestion` is the model's built-in tool for clarifying questions, and it is the ONE ask
    // path Studio uses (the custom `ask_user` MCP tool is gone). Contrary to an earlier belief it is not
    // interactive-terminal-only: per the Agent SDK's user-input contract it reaches `canUseTool` (even
    // when an allow rule matches), and is answered by returning `{behavior:'allow', updatedInput:
    // {questions, answers}}`. That is exactly the seam Studio renders locally AND forwards to claude.ai
    // (#331) — the mobile/web clients render the question card natively, the same channel permissions
    // ride. So it is left enabled and handled in `canUseTool` (see the `AskUserQuestion` branch below).
    const disallowedTools: readonly string[] = [
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
        // The workbench tools ride on EVERY surface, unlike everything else here. Opening a top-level
        // tab is an application action rather than a surface one, so an agent docked to a terminal, a
        // binary or an API collection reaches the same global tab registry as one docked to an editor.
        // Withheld only in read-only chat mode, which never creates anything.
        ...(readOnly
          ? []
          : [
              tool(
                OPEN_DOCUMENT,
                'Open a new tab containing a document you have written — a report, a design note, a draft file — and show it to the user. The document opens UNSAVED and touches nothing on disk, so opening one is free and reversible (the user closes the tab). Use it instead of pasting anything long into the conversation. Returns an id to pass to save_document if the user later asks to keep it.',
                {
                  format: z
                    .enum(['markdown', 'code'])
                    .describe(
                      'markdown for prose (rendered in the markdown editor), code for anything else.',
                    ),
                  title: z
                    .string()
                    .min(1)
                    .describe(
                      "The tab's title, and the name suggested in the save dialog. Write it for a human.",
                    ),
                  content: z.string().describe('The full content of the document.'),
                  language: z
                    .string()
                    .optional()
                    .describe(
                      'For a code document, its language: a Monaco language id (csharp) or display name (C#). Ignored for markdown.',
                    ),
                },
                async (args: {
                  format: string;
                  title: string;
                  content: string;
                  language?: string;
                }) =>
                  text(
                    await openDocument(
                      getContext(),
                      args.format,
                      args.title,
                      args.content,
                      args.language,
                    ),
                  ),
              ),
              tool(
                SAVE_DOCUMENT,
                'Offer to save a document you opened with open_document, through the operating system save dialog. The user chooses the location, or dismisses the dialog. Call it only when the user has said they want to keep the document — it interrupts them with a modal dialog.',
                {
                  id: z
                    .string()
                    .min(1)
                    .describe('The id returned by open_document for the document to save.'),
                },
                async (args: { id: string }) => text(await saveDocument(getContext(), args.id)),
              ),
              tool(
                OPEN_TERMINAL,
                "Open a new terminal tab in the user's default shell. Use it when the user needs a terminal of their own; it spawns a real shell, so do not open one speculatively.",
                {},
                async () => text(await openTerminal(getContext())),
              ),
            ]),
        // Asking the user a clarifying question is not a custom tool: it is the model's built-in
        // `AskUserQuestion`, handled in `canUseTool` below (rendered locally and, under remote control,
        // forwarded to claude.ai). See the `disallowedTools` note above.
        //
        // The run-configuration tools ride on the surfaces whose agents are workspace-scoped: the IDE
        // views (editor) and the standalone agent tab (project). A terminal- or binary-docked agent is
        // deliberately confined to its own surface and gets none of this. Withheld in read-only chat
        // mode, which never writes.
        ...(readOnly || terminal || binary || api
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
              : api
                ? [
                    tool(
                      LIST_API_REQUESTS,
                      "List the API Explorer's collections, saved requests and environments.",
                      {},
                      async () => text(await listApiRequests(getContext())),
                    ),
                    ...(readOnly
                      ? []
                      : [
                          tool(
                            CREATE_API_REQUEST,
                            'Save a new request in the API Explorer and open it in the API well. Reference environment values as {{name}} rather than hard-coding hosts or tokens.',
                            {
                              name: z.string().min(1).describe('The display name of the request.'),
                              method: z
                                .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
                                .describe('The HTTP method.'),
                              url: z
                                .string()
                                .min(1)
                                .describe('The request URL; may contain {{variables}}.'),
                              description: z
                                .string()
                                .optional()
                                .describe(
                                  'What the endpoint does, what it expects and what it returns. Shown with the request.',
                                ),
                              collection: z
                                .string()
                                .optional()
                                .describe(
                                  'The name of the collection to add it to; created when it does not exist. Defaults to the first collection.',
                                ),
                              headers: z
                                .record(z.string(), z.string())
                                .optional()
                                .describe('Request headers, as name/value pairs.'),
                              params: z
                                .record(z.string(), z.string())
                                .optional()
                                .describe('Query parameters, as name/value pairs.'),
                              body: z
                                .string()
                                .optional()
                                .describe('The request body, for a method that carries one.'),
                              body_kind: z
                                .enum(['none', 'json', 'text', 'xml'])
                                .optional()
                                .describe(
                                  'How the body is carried. Defaults to json when a body is given.',
                                ),
                            },
                            async (args: Record<string, unknown>) =>
                              text(await createApiRequest(getContext(), args)),
                          ),
                          tool(
                            UPDATE_API_REQUEST,
                            'Change a saved request. Anything not named is left as it was.',
                            {
                              id: z.string().min(1).describe('The id of the request to change.'),
                              name: z.string().optional().describe('A new display name.'),
                              method: z
                                .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
                                .optional()
                                .describe('A new HTTP method.'),
                              url: z.string().optional().describe('A new URL.'),
                              description: z.string().optional().describe('A new description.'),
                              headers: z
                                .record(z.string(), z.string())
                                .optional()
                                .describe('Headers, replacing the existing ones.'),
                              params: z
                                .record(z.string(), z.string())
                                .optional()
                                .describe('Query parameters, replacing the existing ones.'),
                              body: z.string().optional().describe('A new body.'),
                              body_kind: z
                                .enum(['none', 'json', 'text', 'xml'])
                                .optional()
                                .describe('How the body is carried.'),
                            },
                            async (args: { id: string } & Record<string, unknown>) =>
                              text(await updateApiRequest(getContext(), args.id, args)),
                          ),
                          tool(
                            SEND_API_REQUEST,
                            'Send a saved request and return its status, headers and body. This makes a real call to a real service.',
                            {
                              id: z.string().min(1).describe('The id of the request to send.'),
                            },
                            async (args: { id: string }) =>
                              text(await sendApiRequest(getContext(), args.id)),
                          ),
                          tool(
                            SET_API_VARIABLE,
                            "Set a variable in the API Explorer's active environment, so requests can reference it as {{name}}.",
                            {
                              name: z.string().min(1).describe('The variable name.'),
                              value: z.string().describe('The variable value.'),
                            },
                            async (args: { name: string; value: string }) =>
                              text(await setApiVariable(getContext(), args.name, args.value)),
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
                              text(
                                await runActiveDocument(getContext(), args.timeout_seconds ?? 60),
                              ),
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
      // A clarifying question (the built-in `AskUserQuestion`) is allowed on every surface and in every
      // mode — asking is read-only and the user's answer is itself the gate. It reaches `canUseTool`
      // even in chat/terminal/confined runs, so it is handled first: rendered locally in Studio, and
      // under remote control forwarded to claude.ai so the peer can answer it too (#331). The answer is
      // returned in `updatedInput` per the AskUserQuestion contract.
      if (toolName === ASK_USER_QUESTION_TOOL) {
        return this.answerQuestions(getBridge(), context, input);
      }
      // A terminal-surface run is confined to its terminal: deny every tool that is not one of the two
      // terminal tools, blocking all built-ins (file system, shell, editor). The write tool then falls
      // through to the posture logic below so it prompts unless the posture auto-allows.
      //
      // The workbench tools are exempt: the confinement is about what the agent may *act on* — it must
      // not reach the file system or another view's document — and opening a tab of its own reaches
      // neither. A terminal-docked agent asked to write up what it found would otherwise have nowhere
      // to put it. (Only `open_terminal` reaches this line; the document tools are auto-allowed.)
      if (terminal && !TERMINAL_SURFACE_TOOLS.includes(toolName)) {
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
      const granted: boolean = await this.decidePermission(
        getBridge(),
        context,
        prettyToolName(toolName),
        toolName,
        input,
        summarizeToolInput(input),
      );
      return granted
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'The user declined to run this tool.' };
    };

    const options: Options = {
      // Spawn the CLI under this application's process-lifecycle management (own process group,
      // pid-journal registration, tree kills).
      ...managedSpawnerOption(),
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
      sandbox: buildSandbox(openContext),
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
        // The workbench document tools are auto-allowed on every surface, like the in-app editor
        // tools: a new tab is unsaved and reversible, and saving asks through the OS dialog, which is
        // the gate. `open_terminal` is absent on purpose — it spawns a shell, so it goes through
        // canUseTool like write_terminal_input does.
        ...(readOnly ? [] : [OPEN_DOCUMENT_FQN, SAVE_DOCUMENT_FQN]),
        // `AskUserQuestion` is intentionally NOT auto-allowed: it must reach `canUseTool` so Studio can
        // render it and (under remote control) forward it to the peer, then return the answer.
        // Listing run configurations is a read: auto-allowed wherever the tools are registered, so the
        // agent can see what exists without a prompt. Saving and deleting are writes and go through
        // canUseTool like any other mutation.
        ...(readOnly || terminal || binary || api ? [] : [LIST_RUN_CONFIGURATIONS_FQN]),
        // Listing the API collections is a read, so it is auto-allowed. Creating, updating and
        // sending are not: a send is a real call to a real service, so it goes through canUseTool
        // exactly as running a file does.
        ...(api ? [LIST_API_REQUESTS_FQN] : []),
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

    logger.debug(
      'ClaudeAgentProvider.buildRunOptions',
      `Run options resolved: model=${openContext.model}, effort=${openContext.effort ?? 'default'}, ` +
        `remoteControl=${openContext.remoteControl}, ` +
        `readOnly=${readOnly}, disallowed=${disallowedTools.length}, ` +
        `confinementRoots=${confinementRoots.length}, resume=${openContext.resumeSessionId !== null}`,
    );
    return options;
  }

  /**
   * Resolves a tool permission, racing the local (Studio) prompt against the remote peer (whichever
   * device is driving the session over remote control — phone, tablet, another computer, or the web)
   * when a remote-control bridge is live and controllable. Whichever side answers first wins, and the
   * other side's prompt is dismissed: a remote answer aborts Studio's local prompt (see the optional
   * cancel signal on {@link AgentRunContext.requestPermission}); a Studio answer cancels the forwarded
   * control request on the bridge. With no controllable bridge the local prompt alone decides.
   * @param bridge The session's remote-control bridge, or null when remote control is off/mirror-only.
   * @param context The current turn context (owns the local permission prompt).
   * @param displayName The human-facing tool name shown in Studio's prompt.
   * @param toolName The raw SDK tool name forwarded to the peer.
   * @param input The tool input forwarded to the peer.
   * @param detail The human-facing detail shown in Studio's prompt.
   * @returns Resolves true when the tool is approved, false when declined by either side.
   */
  private async decidePermission(
    bridge: RemoteControlBridge | null,
    context: AgentRunContext,
    displayName: string,
    toolName: string,
    input: Record<string, unknown>,
    detail: string,
  ): Promise<boolean> {
    // No controllable peer: the local prompt alone decides (mirror is view-only, so its bridge cannot
    // prompt either).
    if (!bridge?.canPrompt) {
      return context.requestPermission(displayName, detail);
    }
    logger.debug(
      'ClaudeAgentProvider.decidePermission',
      `Racing local + remote permission for ${displayName}`,
    );
    // Ask both sides at once; the first answer wins and the loser's prompt is dismissed.
    const studioCancel: AbortController = new AbortController();
    const peer: { readonly id: string; readonly granted: Promise<boolean> } =
      bridge.requestPermission(toolName, input, { displayName, description: detail });
    const studio: Promise<{ readonly granted: boolean; readonly who: 'studio' | 'remote' }> =
      context
        .requestPermission(displayName, detail, studioCancel.signal)
        .then((granted: boolean) => ({ granted, who: 'studio' as const }));
    const remote: Promise<{ readonly granted: boolean; readonly who: 'studio' | 'remote' }> =
      peer.granted.then((granted: boolean) => ({ granted, who: 'remote' as const }));
    const winner: { readonly granted: boolean; readonly who: 'studio' | 'remote' } =
      await Promise.race([studio, remote]);
    if (winner.who === 'remote') {
      studioCancel.abort();
    } else {
      bridge.cancelPermission(peer.id);
    }
    // The prompt has settled: return the session to a running turn on claude.ai.
    bridge.clearAction();
    logger.debug(
      'ClaudeAgentProvider.decidePermission',
      `${winner.who} answered first: ${winner.granted ? 'allow' : 'deny'} for ${displayName}`,
    );
    return winner.granted;
  }

  /**
   * Answers the built-in `AskUserQuestion` tool (the model's clarifying-question tool): renders each of
   * its questions in Studio and, under remote control, forwards the whole prompt to claude.ai so the
   * remote peer can answer it natively on whatever device is driving the session (the mobile/web
   * question card). Whichever side answers first wins; the other prompt is dismissed. The result is
   * returned as an `AskUserQuestion` allow with the answers in `updatedInput` — `{questions, answers}` —
   * or a deny when the user declines.
   * @param bridge The session's remote-control bridge, or null when remote control is off/mirror-only.
   * @param context The current turn context (owns the local question prompts).
   * @param input The `AskUserQuestion` tool input (its `questions` array).
   * @returns Resolves the permission result carrying the answers (never rejects).
   */
  private async answerQuestions(
    bridge: RemoteControlBridge | null,
    context: AgentRunContext,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> {
    const questions: readonly AskUserQuestionQuestion[] = parseAskUserQuestions(input);
    if (questions.length === 0) {
      // Malformed input: nothing to ask. Allow with the input unchanged so the tool resolves rather
      // than blocking the turn.
      return { behavior: 'allow', updatedInput: input };
    }
    // No controllable peer: render locally alone.
    if (!bridge?.canPrompt) {
      const answers: Record<string, string> | null = await this.askQuestionsLocally(
        context,
        questions,
      );
      return this.questionResult(input, answers);
    }
    logger.debug(
      'ClaudeAgentProvider.answerQuestions',
      `Racing local + remote answer for ${questions.length} question(s)`,
    );
    const studioCancel: AbortController = new AbortController();
    const peer: { readonly id: string; readonly answer: Promise<Record<string, unknown> | null> } =
      bridge.requestQuestions(input, questions[0]?.question);
    const studio: Promise<{
      readonly payload: Record<string, unknown> | null;
      readonly who: 'studio' | 'remote';
    }> = this.askQuestionsLocally(context, questions, studioCancel.signal).then(
      (answers: Record<string, string> | null) => ({
        payload: answers === null ? null : { questions: input['questions'], answers },
        who: 'studio' as const,
      }),
    );
    const remote: Promise<{
      readonly payload: Record<string, unknown> | null;
      readonly who: 'studio' | 'remote';
    }> = peer.answer.then((payload: Record<string, unknown> | null) => ({
      payload,
      who: 'remote' as const,
    }));
    const winner: {
      readonly payload: Record<string, unknown> | null;
      readonly who: 'studio' | 'remote';
    } = await Promise.race([studio, remote]);
    if (winner.who === 'remote') {
      studioCancel.abort();
    } else {
      bridge.cancelQuestion(peer.id);
    }
    bridge.clearAction();
    logger.debug(
      'ClaudeAgentProvider.answerQuestions',
      `${winner.who} answered the question(s) first`,
    );
    if (winner.payload === null) {
      return { behavior: 'deny', message: 'The user declined to answer.' };
    }
    return { behavior: 'allow', updatedInput: winner.payload };
  }

  /**
   * Renders each `AskUserQuestion` question in Studio in turn (via the input-request round-trip),
   * collecting the user's selected label(s) or free text. Resolves null when the user declines any
   * question or the prompt is dismissed (e.g. the remote peer answered first, aborting the signal).
   * @param context The current turn context.
   * @param questions The questions to ask.
   * @param cancel An optional signal that dismisses the local prompt when the peer answers first.
   * @returns Resolves the `{question: answer}` map, or null on decline.
   */
  private async askQuestionsLocally(
    context: AgentRunContext,
    questions: readonly AskUserQuestionQuestion[],
    cancel?: AbortSignal,
  ): Promise<Record<string, string> | null> {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const choices: readonly AiInputChoice[] = q.options.map((option: AskUserQuestionOption) => ({
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
      }));
      const answer: string | null = await context.requestInput(q.question, choices, cancel);
      if (answer === null) {
        return null;
      }
      answers[q.question] = answer;
    }
    return answers;
  }

  /**
   * Builds the `AskUserQuestion` permission result from a local answers map: an allow carrying
   * `{questions, answers}` in `updatedInput`, or a deny when the user declined.
   * @param input The original tool input (its `questions` array is echoed back, as the tool requires).
   * @param answers The collected answers, or null on decline.
   * @returns Returns the permission result.
   */
  private questionResult(
    input: Record<string, unknown>,
    answers: Record<string, string> | null,
  ): PermissionResult {
    if (answers === null) {
      return { behavior: 'deny', message: 'The user declined to answer.' };
    }
    return { behavior: 'allow', updatedInput: { questions: input['questions'], answers } };
  }

  /**
   * Runs a single turn through the Agent SDK, streaming reasoning, text, and tool activity. A transient
   * run: opens a live session, runs this one turn into it, then closes it — behaviour identical to the
   * old single-shot run. The persistent path (holding the session open across turns, #327) drives the
   * same {@link ClaudeAgentSession} through {@link openSession}/{@link AgentSession.turn} instead.
   * @param context The run context.
   */
  public async run(context: AgentRunContext): Promise<void> {
    logger.trace('ClaudeAgentProvider.run', `Transient run for request ${context.requestId}`);
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
    logger.info(
      'ClaudeAgentProvider.openSession',
      `Opening Claude session for surface '${context.surface}' (agent ${context.agentSessionId})`,
    );
    return new ClaudeAgentSession(
      {
        buildRunOptions: (
          getContext: () => AgentRunContext,
          controller: AbortController,
          getBridge: () => RemoteControlBridge | null,
        ): Promise<Options> => this.buildRunOptions(getContext, controller, getBridge),
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
          : surface === 'api'
            ? API_PROMPT_APPENDIX
            : surface === 'project'
              ? PROJECT_PROMPT_APPENDIX
              : STUDIO_PROMPT_APPENDIX;
    // Every surface learns it can ask the user clarifying questions (via the built-in AskUserQuestion)
    // instead of guessing.
    const withAsk: string = `${base}\n\n${CLARIFYING_QUESTION_APPENDIX}`;
    if (readOnly) {
      return `${withAsk}\n\n${READ_ONLY_APPENDIX}`;
    }
    // The workbench tools are registered on every surface, so every surface is told about them.
    const withWorkbench: string = `${withAsk}\n\n${WORKBENCH_PROMPT_APPENDIX}`;
    // The run-configuration tools are registered on the workspace-scoped surfaces only, so only those
    // are told how to author them (see the tool registration in `buildRunOptions`).
    return surface === 'terminal' || surface === 'binary' || surface === 'api'
      ? withWorkbench
      : `${withWorkbench}\n\n${RUN_CONFIGURATION_PROMPT_APPENDIX}`;
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
    logger.debug(
      'ClaudeAgentProvider.executableOption',
      executable === undefined
        ? `No explicit Claude executable (mode '${choice?.mode ?? 'bundled'}'); SDK will resolve its own`
        : `Resolved Claude executable: ${executable}`,
    );
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
    logger.trace(
      'ClaudeAgentProvider.listSupportedModels',
      'Discovering Claude models via the SDK',
    );
    const options: Options = { ...this.executableOption(executable), ...managedSpawnerOption() };
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
      logger.debug(
        'ClaudeAgentProvider.listSupportedModels',
        `SDK reported ${models.length} supported model(s)`,
      );
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
        logger.debug(
          'ClaudeAgentProvider.runEnv',
          `Overlaid agent shell environment from ${shell}`,
        );
      } else {
        logger.warn(
          'ClaudeAgentProvider.runEnv',
          `Could not capture agent shell environment from ${shell}; using inherited env`,
        );
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
  buildRunOptions(
    getContext: () => AgentRunContext,
    controller: AbortController,
    getBridge: () => RemoteControlBridge | null,
  ): Promise<Options>;

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
   * The claude.ai/code bridge for this session when remote control is on (#331), or null when off or
   * unavailable. Opened at first-turn open from the opening context's mode; closed with the session.
   */
  private bridge: RemoteControlBridge | null = null;

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
   * Gets a value indicating whether the session can still take a turn: it is neither closed nor has its
   * held-open query ended underneath it. The pump sets {@link inputClosed} when its message stream ends
   * (the SDK subprocess exited or the stream closed) even when no turn was in flight to carry the
   * failure — after which a reused session would accept a turn that never settles. The manager reads
   * this before reusing the session so a dead one is reopened instead of silently hanging.
   */
  public get alive(): boolean {
    return !this.closed && !this.inputClosed;
  }

  /**
   * Runs a turn in this session, streaming its events through the context and settling when the turn's
   * `result` arrives — leaving the session open for the next turn. Opens the query lazily on the first
   * turn.
   * @param context The turn's context.
   */
  public async turn(context: AgentRunContext): Promise<void> {
    this.currentContext = context;
    logger.trace(
      'ClaudeAgentSession.turn',
      `Turn dispatch for request ${context.requestId} (model ${context.model})`,
    );
    if (this.sdkQuery === null) {
      await this.openInternal();
      this.appliedModel = context.model;
    } else if (context.model !== this.appliedModel) {
      // A later turn changed the model: apply it live, since the query's model was bound at open.
      logger.debug(
        'ClaudeAgentSession.turn',
        `Applying live model change '${this.appliedModel}' -> '${context.model}'`,
      );
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
    logger.trace('ClaudeAgentSession.interrupt', 'Interrupting the in-flight Claude turn');
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
    logger.info(
      'ClaudeAgentSession.close',
      `Closing Claude session${this.reportedSessionId === null ? '' : ` ${this.reportedSessionId}`}`,
    );
    this.closed = true;
    this.inputClosed = true;
    this.currentContext.setSteerHandler(null);
    this.bridge?.close();
    this.bridge = null;
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
    logger.trace('ClaudeAgentSession.openInternal', 'Opening the SDK query and starting the pump');
    this.controller = new AbortController();
    // Pass a live accessor, not a snapshot: the per-turn tool/gate/audit closures resolve the session's
    // current turn context each invocation (`turn()` swaps it), while the frozen structural options read
    // it once, at open.
    const options: Options = await this.deps.buildRunOptions(
      (): AgentRunContext => this.currentContext,
      this.controller,
      (): RemoteControlBridge | null => this.bridge,
    );
    this.sdkQuery = await this.deps.createQuery(this.promptStream(), options);
    this.pumpDone = this.pump();
    // Discover the session's slash commands once it is open (#330); refreshed later by the
    // `commands_changed` push handled in the pump. Best-effort — a failure never disturbs the run.
    void this.emitCommands();
    // Bridge the session to claude.ai/code when remote control is on (#331). Bound at open like the
    // structural options, so a mid-session mode change takes effect on reopen. Best-effort.
    if (this.currentContext.remoteControl !== 'off') {
      this.openBridge(this.currentContext);
    }
  }

  /**
   * Opens the claude.ai/code bridge for the session (#331), asynchronously. In control mode a peer's
   * message is injected into the session exactly like a steered follow-up. Best-effort: any failure
   * leaves the local run untouched and the session simply stays unbridged.
   * @param context The opening turn's context (its remote-control mode is used).
   */
  private openBridge(context: AgentRunContext): void {
    const cwd: string = context.workspaceRoot ?? homedir();
    void RemoteControlBridge.open({
      mode: context.remoteControl === 'control' ? 'control' : 'mirror',
      title: `ONIXLabs Studio — ${basename(cwd)}`,
      cwd,
      model: context.model,
      onInbound: (text: string): void => {
        if (this.inputClosed) {
          return;
        }
        // Echo the peer's message into Studio's transcript and let the renderer adopt the turn, so the
        // response — and any permission/input prompts it raises — render in Studio too, not only on the
        // remote device (#331). Emitted on the current context so it carries the turn's request id.
        this.currentContext.emit({
          requestId: this.currentContext.requestId,
          kind: 'remote-message',
          agentSessionId: this.currentContext.agentSessionId,
          text,
        });
        this.pendingMessages.push(userMessageOf(text));
        this.wake?.();
      },
    }).then((bridge: RemoteControlBridge | null): void => {
      // The session may have closed while the bridge was opening; drop it if so.
      if (this.closed) {
        bridge?.close();
        return;
      }
      this.bridge = bridge;
    });
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
    } catch (error: unknown) {
      // Command discovery is best-effort; never let it disturb the session.
      logger.debug('ClaudeAgentSession.emitCommands', 'Slash command discovery failed', error);
    }
  }

  /**
   * Publishes a discovered command set to the renderer through the current turn's context.
   * @param commands The SDK slash commands.
   */
  private publishCommands(commands: readonly SlashCommand[]): void {
    // Diagnostic (#330): surface what the SDK actually reports, so a missing command can be told apart
    // from a discovery/routing problem. Recorded in the log audit.
    logger.debug(
      'claude-agent',
      `Discovered ${commands.length} slash command(s): ${commands
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
   * Publishes a settled background task to the renderer through the current turn's context. Session-
   * scoped like {@link publishCommands} (carries the agent session id), so the renderer surfaces it
   * even when it arrives after the launching turn has ended and no run is in flight.
   * @param message The SDK task-notification message.
   */
  private publishBackgroundTask(message: SDKTaskNotificationMessage): void {
    this.currentContext.emit({
      requestId: this.currentContext.requestId,
      kind: 'background-task',
      agentSessionId: this.currentContext.agentSessionId,
      status: message.status,
      summary: message.summary,
      ...(message.tool_use_id === undefined ? {} : { toolId: message.tool_use_id }),
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
          logger.info('ClaudeAgentSession.pump', `Session id reported: ${sessionId}`);
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
        // A backgrounded task (a `run_in_background` shell command or subagent) has settled: the SDK
        // emits a `task_notification` on the held-open stream, which can arrive after the launching
        // turn has ended and the conversation has gone idle. Surface it so the "I'll tell you when it
        // finishes" promise is actually kept, rather than the completion being silently dropped.
        const task: { type?: string; subtype?: string } = message;
        if (task.type === 'system' && task.subtype === 'task_notification') {
          this.publishBackgroundTask(message as SDKTaskNotificationMessage);
        }
        this.deps.handleMessage(message, this.currentContext, this.usageState);
        // Mirror the message to claude.ai/code when the session is bridged (#331). Best-effort.
        this.bridge?.forward(message);
        // A turn's `result` settles that turn but leaves the stream open for the next turn; an
        // interrupted turn arrives here too (the SDK emits a `result` for it). The stream itself ends
        // only when the input closes (via {@link close}), never on a per-turn abort — so a Stop
        // interrupts the turn without ending the session.
        if (message.type === 'result' && this.pendingMessages.length === 0) {
          // A Studio-initiated turn is awaited by an AiManager run (turnSettle set), which emits the
          // terminal status that clears the renderer's spinner. A turn driven entirely by a remote peer
          // (any device driving the session) was injected straight into the stream (see the bridge's
          // onInbound) with no run behind it, so nothing would emit its completion — the turn the
          // renderer adopted via `remote-message` (busy=true) would spin forever. Emit the terminal
          // status here for that case, under the same request id the adoption used.
          const peerDrivenTurn: boolean = this.turnSettle === null && this.bridge !== null;
          this.settleTurn();
          if (peerDrivenTurn) {
            this.currentContext.emit({
              requestId: this.currentContext.requestId,
              kind: 'status',
              state: 'completed',
              detail: '',
            });
          }
        }
      }
    } catch (error: unknown) {
      // A deliberate teardown ({@link close} aborted the master controller) ends any in-flight turn as
      // settled; any other stream error rejects the in-flight turn so the manager lands it as an error
      // (and evicts the now-dead session so the next turn opens fresh).
      if (this.closed) {
        this.settleTurn();
      } else {
        logger.error('claude-agent', 'Agent turn stream failed', error);
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

/**
 * Builds the SDK sandbox settings for a run.
 *
 * This is where the confinement the `canUseTool` gate cannot reach is expressed. That gate sees a
 * tool's *arguments*, so it can range-check a file write but not a shell command; the OS sandbox sees
 * the syscalls, so it covers `Bash` and the SDK's own web access. Three things are handed to it:
 *
 * - the **denied write paths**, which the gate already enforces for the file-write tools, so the same
 *   list now also stops a shell command writing there (`.git`, `.env`, `~/.ssh`);
 * - the **allowed write paths**, so a granted shell write to a widened root is not blocked by the
 *   sandbox after the gate allowed it;
 * - the **network locations**, which have no gate equivalent at all — an allow list narrows egress to
 *   the hosts the user named, and a deny list wins over it, exactly as the write paths behave.
 *
 * Every list is omitted when empty, so a user who has configured nothing gets precisely the sandbox
 * Studio has always applied.
 * @param context The opening run context.
 * @returns Returns the sandbox settings for the run.
 */
function buildSandbox(context: AgentRunContext): SandboxSettings {
  const sandbox: SandboxSettings = {
    enabled: true,
    autoAllowBashIfSandboxed: false,
    failIfUnavailable: false,
  };
  if (context.allowedWritePaths.length > 0 || context.deniedWritePaths.length > 0) {
    sandbox.filesystem = {
      ...(context.allowedWritePaths.length > 0
        ? { allowWrite: [...context.allowedWritePaths] }
        : {}),
      // Only absolute entries reach the sandbox: a bare segment such as `.git` is a pattern the gate
      // understands and the sandbox does not, so it stays gate-only rather than being mistranslated
      // into a path that would silently match nothing.
      ...(absolutePathsOf(context.deniedWritePaths).length > 0
        ? { denyWrite: absolutePathsOf(context.deniedWritePaths) }
        : {}),
    };
  }
  if (context.allowedNetworkLocations.length > 0 || context.deniedNetworkLocations.length > 0) {
    // Expanded on the way out: the sandbox matches label-for-label, so `*.example.com` reaches it as
    // both itself and the apex it is taken to include here. Without that, the same list would allow a
    // request through the API tools and block it in the shell.
    sandbox.network = {
      ...(context.allowedNetworkLocations.length > 0
        ? { allowedDomains: [...expandNetworkLocations(context.allowedNetworkLocations)] }
        : {}),
      ...(context.deniedNetworkLocations.length > 0
        ? { deniedDomains: [...expandNetworkLocations(context.deniedNetworkLocations)] }
        : {}),
    };
  }
  return sandbox;
}

/**
 * Keeps only the absolute paths of a deny list, dropping the bare segments the file-write gate
 * matches anywhere in a path.
 * @param entries The configured deny entries.
 * @returns Returns the absolute entries.
 */
function absolutePathsOf(entries: readonly string[]): string[] {
  return entries.filter((entry: string): boolean => isAbsolute(entry));
}
