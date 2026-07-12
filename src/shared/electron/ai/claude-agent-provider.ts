import { homedir } from 'node:os';
import type {
  CanUseTool,
  McpSdkServerConfigWithInstance,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
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
  WRITE_TERMINAL_INPUT,
  type InsertPlacement,
  type AgentContextRef,
  type AgentSurface,
  type AiModelInfo,
  type AiPermissionPosture,
  type AiProviderId,
  type AiVerifyResult,
} from '@shared/api/ai-types';
import type {
  AgentAuth,
  AgentProvider,
  AgentRunContext,
  ProviderAvailability,
} from './agent-provider';
import type { AiCredential } from './ai-auth-manager';
import { resolveBundledClaudeExecutable } from './claude-executable';
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL } from './models';
import {
  BINARY_PROMPT_APPENDIX,
  EDIT_TOOL_FQN,
  INSERT_TOOL_FQN,
  PROJECT_PROMPT_APPENDIX,
  READ_BINARY_BYTES_FQN,
  READ_BINARY_DISASSEMBLY_FQN,
  READ_BINARY_OVERVIEW_FQN,
  READ_BINARY_SELECTION_FQN,
  READ_TERMINAL_FQN,
  READ_TOOL_FQN,
  REPLACE_TOOL_FQN,
  STUDIO_PROMPT_APPENDIX,
  TERMINAL_PROMPT_APPENDIX,
  WRITE_TERMINAL_FQN,
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
  writeTerminalInput,
} from './studio-tools';
import { prettyToolName, summarizeToolInput } from './tool-format';

/**
 * Holds the model the verification turn runs with (the default; verification does not depend on the
 * user's per-run model choice).
 */
const VERIFY_MODEL: string = DEFAULT_ANTHROPIC_MODEL;

/**
 * Holds how long (ms) to wait for the verification turn before aborting.
 */
const VERIFY_TIMEOUT_MS: number = 45_000;

/**
 * Holds the built-in tools auto-allowed when a workspace is open: read-only project exploration.
 * These are always allowed regardless of the permission posture.
 */
const READ_ONLY_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep'];

/**
 * Holds the system-prompt note appended on a chat-mode (read-only) run, telling the model it may
 * inspect but must not modify files or run commands.
 */
const READ_ONLY_APPENDIX: string =
  'You are in read-only chat mode. You may inspect the project and the active surface, but you must ' +
  'not modify files or run commands — editing and executing tools are disabled. Answer, explain, and ' +
  'advise instead of acting.';

/**
 * Holds the built-in file-editing tools auto-allowed under the `auto-edits` permission posture.
 */
const EDIT_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

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
  public readonly models: readonly AiModelInfo[] = ANTHROPIC_MODELS;

  /**
   * Gets the identifier of Claude's default model.
   */
  public readonly defaultModelId: string = DEFAULT_ANTHROPIC_MODEL;

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
   * Runs a single turn through the Agent SDK, streaming reasoning, text, and tool activity.
   * @param context The run context.
   */
  public async run(context: AgentRunContext): Promise<void> {
    const { query, tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
    const { z } = await import('zod');
    const hasWorkspace: boolean = context.workspaceRoot !== null;
    const surface: AgentSurface = context.surface;
    const terminal: boolean = surface === 'terminal';
    const binary: boolean = surface === 'binary';
    // The standalone agent tab has no owning document: no in-app studio tools are registered, and the
    // run works through the SDK's built-in tools alone (gated by the permission posture as usual).
    const project: boolean = surface === 'project';
    // Chat mode runs read-only: the mutating in-app tool is withheld and every editing/executing tool
    // is denied, so the agent may inspect the project and the surface but never changes anything.
    const readOnly: boolean = context.mode === 'chat';
    // Attached files/folders are readable via the built-in Read/Glob tools even without an open
    // workspace, so those tools are auto-allowed when either a workspace or attached context is present.
    const hasReadableContext: boolean = hasWorkspace || context.contextPaths.length > 0;

    // Build a text-content tool result from a handler's rendered string.
    const text: (value: string) => { content: { type: 'text'; text: string }[] } = (
      value: string,
    ) => ({
      content: [{ type: 'text', text: value }],
    });

    // Expose Studio's in-app capabilities as an in-process MCP server; the tool handlers call back
    // into the renderer over the run context's bridge. A terminal-surface run registers ONLY the two
    // terminal tools, so the agent acts solely through its terminal; a binary-surface run registers
    // the binary inspection/patch tools; an editor run registers the editor tools. Each tool array is
    // inline so each tool keeps its own input-shape generic.
    const studioServer: McpSdkServerConfigWithInstance = createSdkMcpServer({
      name: 'studio',
      version: '0.0.0',
      tools: project
        ? []
        : terminal
        ? [
            tool(
              READ_TERMINAL_OUTPUT,
              'Read the recent output currently shown in the terminal.',
              {},
              async () => text(await readTerminalOutput(context)),
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
                      text(await writeTerminalInput(context, args.text, args.submit ?? true)),
                  ),
                ]),
          ]
        : binary
          ? [
              tool(
                READ_BINARY_OVERVIEW,
                'Describe the open binary file: path, size, container format, architecture, whether disassembly is available, and the current cursor/selection.',
                {},
                async () => text(await readBinaryOverview(context)),
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
                  text(await readBinaryBytes(context, args.offset, args.length ?? 256)),
              ),
              tool(
                READ_BINARY_SELECTION,
                'Return a hex + ASCII dump of the bytes the user has selected in the open binary file.',
                {},
                async () => text(await readBinarySelection(context)),
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
                  text(await readBinaryDisassembly(context, args.offset, args.length ?? 256)),
              ),
              ...(readOnly
                ? []
                : [
                    tool(
                      PATCH_BINARY_BYTES,
                      'Overwrite bytes at an offset in the open binary file (the length is unchanged). Produces an unsaved, undoable edit the user reviews and saves.',
                      {
                        offset: z.number().int().min(0).describe('The offset to overwrite from.'),
                        bytes: z
                          .string()
                          .describe(
                            'The replacement bytes as a hex string, e.g. "4d 5a" or "4D5A".',
                          ),
                      },
                      async (args: { offset: number; bytes: string }) =>
                        text(await patchBinaryBytes(context, args.offset, args.bytes)),
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
                          .describe('The bytes to insert as a hex string, e.g. "4d 5a" or "4D5A".'),
                      },
                      async (args: { offset: number; bytes: string }) =>
                        text(await insertBinaryBytes(context, args.offset, args.bytes)),
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
                        text(await deleteBinaryBytes(context, args.offset, args.length)),
                    ),
                  ]),
            ]
          : [
              tool(
                READ_ACTIVE_DOCUMENT,
                "Read the active editor document's full text.",
                {},
                async () => text(await readActiveDocument(context)),
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
                          .describe('The exact text to replace; must match the document verbatim.'),
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
                            context,
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
                            context,
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
                        text(await replaceActiveDocument(context, args.text)),
                    ),
                  ]),
            ],
    });

    // Apply the permission posture: read-only exploration is always allowed; `auto-all` allows every
    // tool; `auto-edits` also allows file edits but still asks before shell/exec; `prompt` asks before
    // anything mutating or executing. On allow, `updatedInput` MUST echo the original input — it is the
    // input the SDK runs the tool with; omitting it runs the tool with no arguments and fails as a
    // malformed response.
    const posture: AiPermissionPosture = context.permissionPosture;
    const canUseTool: CanUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<PermissionResult> => {
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

    const controller: AbortController = this.linkAbort(context.signal);
    const options: Options = {
      model: context.model,
      cwd: context.workspaceRoot ?? homedir(),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: this.systemAppendix(surface, readOnly),
      },
      // A project-surface run registers no in-app server at all — the standalone agent works through
      // the SDK's built-in tools alone.
      ...(project ? {} : { mcpServers: { studio: studioServer } }),
      // For a terminal run, auto-allow only the read tool; the write tool is intentionally omitted so
      // it flows through canUseTool (prompting unless the posture auto-allows). For a binary run,
      // auto-allow the read-only inspection tools (and read-only project exploration); the byte-patch
      // tool is omitted so it flows through canUseTool. For an editor run, auto-allow the in-app editor
      // tools (the user sees and can undo the change) and read-only project exploration; canUseTool
      // gates everything else. A project run auto-allows read-only exploration only.
      allowedTools: terminal
        ? [READ_TERMINAL_FQN]
        : binary
          ? [...BINARY_READ_FQNS, ...(hasReadableContext ? READ_ONLY_TOOLS : [])]
          : project
            ? [...(hasReadableContext ? READ_ONLY_TOOLS : [])]
            : [
                READ_TOOL_FQN,
                ...(readOnly ? [] : [EDIT_TOOL_FQN, INSERT_TOOL_FQN, REPLACE_TOOL_FQN]),
                ...(hasReadableContext ? READ_ONLY_TOOLS : []),
              ],
      canUseTool,
      abortController: controller,
      // Resume the conversation's prior session when one exists, so the model keeps the earlier turns'
      // context (the SDK replays the persisted session transcript, including tool calls and results).
      // Absent on a conversation's first turn, which starts a fresh session.
      ...(context.resumeSessionId !== null ? { resume: context.resumeSessionId } : {}),
      // Cap the turn's token budget when the user set one; the SDK sends it as the API-side task
      // budget so the model paces its tool use and wraps up before the limit.
      ...(context.tokenCap > 0 ? { taskBudget: { total: context.tokenCap } } : {}),
      ...this.executableOption(),
      ...(this.runEnv(context.auth) ?? {}),
    };

    const response: Query = query({ prompt: this.buildPrompt(context), options });
    let reportedSessionId: string | null = null;
    for await (const message of response) {
      if (context.signal.aborted) {
        break;
      }
      // Surface the SDK session id so the renderer can resume this conversation on its next turn. Every
      // message carries it; report it once (and again if it ever changes, e.g. a forked resume).
      const sessionId: string | null = this.sessionIdOf(message);
      if (sessionId !== null && sessionId !== reportedSessionId) {
        reportedSessionId = sessionId;
        context.emit({ requestId: context.requestId, kind: 'session', sessionId });
      }
      this.handleMessage(message, context);
    }
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
    return readOnly ? `${base}\n\n${READ_ONLY_APPENDIX}` : base;
  }

  /**
   * Builds the prompt for a run: the user's prompt, preceded by a preamble listing any attached
   * context so the agent reads those files and folders with its own file tools.
   * @param context The run context.
   * @returns Returns the prompt to send.
   */
  private buildPrompt(context: AgentRunContext): string {
    if (context.contextPaths.length === 0) {
      return context.prompt;
    }
    const lines: string = context.contextPaths
      .map((ref: AgentContextRef): string => ` - ${ref.path} (${ref.kind})`)
      .join('\n');
    const preamble: string =
      'The user attached the following context. Read the files and explore the folders with your ' +
      `file tools (Read, Glob, Grep) as needed to answer:\n${lines}`;
    return `${preamble}\n\n${context.prompt}`;
  }

  /**
   * Runs a single trivial turn to confirm the credential authenticates end-to-end.
   * @param credential The credential to authenticate with.
   * @returns Returns the {@link AiVerifyResult}; never throws.
   */
  public async verify(credential: AiCredential): Promise<AiVerifyResult> {
    if (credential.source === 'none') {
      return { ok: false, detail: 'No Claude credential is available.' };
    }
    const controller: AbortController = new AbortController();
    const timeout: NodeJS.Timeout = setTimeout((): void => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const auth: AgentAuth = {
        hasLocalLogin: credential.source === 'local-login',
        apiKey: credential.apiKey,
      };
      const options: Options = {
        model: VERIFY_MODEL,
        cwd: homedir(),
        maxTurns: 1,
        abortController: controller,
        ...this.executableOption(),
        ...(this.runEnv(auth) ?? {}),
      };
      const response: Query = query({ prompt: 'Reply with the single word: OK', options });
      for await (const message of response) {
        if (message.type === 'assistant') {
          return {
            ok: true,
            detail:
              credential.source === 'local-login'
                ? 'Authenticated with your local Claude login.'
                : 'Authenticated with your Anthropic API key.',
          };
        }
      }
      return { ok: false, detail: 'The agent did not produce a response.' };
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: `Authentication check failed: ${message}` };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Builds the `pathToClaudeCodeExecutable` option in a packaged build, where the Agent SDK's own
   * resolution points inside `app.asar` and cannot spawn the bundled CLI. In development it returns an
   * empty object so the SDK resolves the binary itself.
   * @returns Returns `{ pathToClaudeCodeExecutable }` when packaged and the binary is present, else `{}`.
   */
  private executableOption(): { pathToClaudeCodeExecutable: string } | Record<string, never> {
    const executable: string | undefined = resolveBundledClaudeExecutable();
    return executable === undefined ? {} : { pathToClaudeCodeExecutable: executable };
  }

  /**
   * Builds the `env` option that injects an API key, or null when the local login should be used
   * (the SDK then authenticates from `~/.claude`).
   * @param auth The resolved credential material.
   * @returns Returns `{ env }`, or null to leave the environment untouched.
   */
  private runEnv(auth: AgentAuth): { env: Record<string, string> } | null {
    if (auth.hasLocalLogin || auth.apiKey === null) {
      return null;
    }
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        env[name] = value;
      }
    }
    env['ANTHROPIC_API_KEY'] = auth.apiKey;
    return { env };
  }

  /**
   * Creates an abort controller that fires when the run's signal aborts.
   * @param signal The run's abort signal.
   * @returns Returns the linked controller.
   */
  private linkAbort(signal: AbortSignal): AbortController {
    const controller: AbortController = new AbortController();
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', (): void => controller.abort(), { once: true });
    }
    return controller;
  }

  /**
   * Translates an SDK message into transcript events: reasoning, assistant text, and tool lifecycle.
   * @param message The SDK message.
   * @param context The run context to emit through.
   */
  private handleMessage(message: SDKMessage, context: AgentRunContext): void {
    if (message.type === 'assistant') {
      this.handleAssistantBlocks(message.message.content as readonly ContentBlock[], context);
    } else if (message.type === 'user') {
      this.handleToolResults(message, context);
    }
  }

  /**
   * Emits reasoning, text, and tool-start events for an assistant message's content blocks.
   * @param blocks The assistant content blocks.
   * @param context The run context to emit through.
   */
  private handleAssistantBlocks(blocks: readonly ContentBlock[], context: AgentRunContext): void {
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        context.emit({ requestId: context.requestId, kind: 'text', delta: block.text });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        context.emit({ requestId: context.requestId, kind: 'thinking', delta: block.thinking });
      } else if (block.type === 'tool_use' && typeof block.id === 'string') {
        context.emit({
          requestId: context.requestId,
          kind: 'tool-start',
          toolId: block.id,
          name: prettyToolName(block.name ?? 'tool'),
          detail: summarizeToolInput(block.input),
        });
      }
    }
  }

  /**
   * Emits tool-end events for the tool-result blocks carried by a user message.
   * @param message The user SDK message.
   * @param context The run context to emit through.
   */
  private handleToolResults(message: SDKMessage, context: AgentRunContext): void {
    const content: unknown = (message as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) {
      return;
    }
    for (const block of content as readonly ContentBlock[]) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        context.emit({
          requestId: context.requestId,
          kind: 'tool-end',
          toolId: block.tool_use_id,
          ok: block.is_error !== true,
          detail: block.is_error === true ? 'failed' : 'done',
        });
      }
    }
  }
}
