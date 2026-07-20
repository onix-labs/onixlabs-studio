import { homedir } from 'node:os';
import type {
  CanUseTool,
  HookJSONOutput,
  McpSdkServerConfigWithInstance,
  Options,
  PermissionResult,
  PostToolUseHookInput,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  ASK_USER,
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
  SET_ACTIVE_DOCUMENT_LANGUAGE,
  WRITE_BINARY_ASSEMBLY,
  WRITE_TERMINAL_INPUT,
  type InsertPlacement,
  type AgentSurface,
  type AiImageRef,
  type AiInputChoice,
  type AiModelInfo,
  type AiPermissionPosture,
  type AiProviderId,
  type AiToolPolicy,
} from '@shared/api/ai-types';
import type {
  AgentAuth,
  AgentProvider,
  AgentRunContext,
  ProviderAvailability,
} from './agent-provider';
import { resolveBundledClaudeExecutable } from './claude-executable';
import {
  ASK_USER_DESCRIPTION,
  ASK_USER_FQN,
  ASK_USER_PROMPT_APPENDIX,
  BINARY_PROMPT_APPENDIX,
  EDIT_TOOL_FQN,
  INSERT_TOOL_FQN,
  PROJECT_PROMPT_APPENDIX,
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
    // The standalone agent tab has no owning document: beyond the ask-user tool, no in-app studio
    // tools are registered, and the run works through the SDK's built-in tools alone (gated by the
    // permission posture as usual).
    const project: boolean = surface === 'project';
    // Chat mode runs read-only: the mutating in-app tool is withheld and every editing/executing tool
    // is denied, so the agent may inspect the project and the surface but never changes anything.
    const readOnly: boolean = context.mode === 'chat';
    // Attached files/folders are readable via the built-in Read/Glob tools even without an open
    // workspace, so those tools are auto-allowed when either a workspace or attached context is present.
    const hasReadableContext: boolean = hasWorkspace || context.contextPaths.length > 0;

    // Write-confinement roots (#307): the filesystem area a granted file write may touch. The first
    // root is the run's working directory (the SDK's `cwd`), so a relative target anchors to the
    // workspace; the user's allowed write paths (#310) widen it. Left empty for a no-workspace run,
    // which keeps today's unconfined home-directory behaviour.
    const additionalDirectories: readonly string[] = context.allowedWritePaths;
    const confinementRoots: readonly string[] = hasWorkspace
      ? [context.workspaceRoot!, ...additionalDirectories]
      : [];

    // Tools the user's policy denies (#309) are removed from the model's context via the SDK's
    // `disallowedTools`, NOT left to the `canUseTool` gate: the Claude Code CLI auto-runs commands its
    // own safety classifier deems safe (e.g. `echo`) WITHOUT calling `canUseTool`, so a gate-only deny
    // would leak them. `disallowedTools` blocks the tool outright, whatever the classifier decides.
    // Keyed on display name, which equals the SDK name for these built-in tools. The `canUseTool` deny
    // below stays as a backstop for anything that does reach the gate.
    const disallowedTools: readonly string[] = Object.entries(context.toolPolicies)
      .filter(([, value]: [string, string]): boolean => value === 'deny')
      .map(([tool]: [string, string]): string => tool);

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
            text(await askUser(context, args.question, args.choices ?? [])),
        ),
        ...(project
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
                              .describe(
                                'The bytes to insert as a hex string, e.g. "4d 5a" or "4D5A".',
                              ),
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
                                context,
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
                            text(await setActiveDocumentLanguage(context, args.language)),
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
    const posture: AiPermissionPosture = context.permissionPosture;
    const canUseTool: CanUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<PermissionResult> => {
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
        if (target !== null && confinementRoots.length > 0 && !isWriteWithinRoots(target, confinementRoots)) {
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
        if (target !== null && isWriteDenied(target, context.deniedWritePaths, context.workspaceRoot ?? homedir())) {
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

    const controller: AbortController = this.linkAbort(context.signal);
    const options: Options = {
      model: context.model,
      cwd: context.workspaceRoot ?? homedir(),
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
                      coarseGrantSource(policy, posture, EDIT_TOOLS.includes(raw)),
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
      ...(context.resumeSessionId !== null ? { resume: context.resumeSessionId } : {}),
      ...(context.resumeSessionId !== null && context.resumeSessionAt !== null
        ? { resumeSessionAt: context.resumeSessionAt }
        : {}),
      ...(context.resumeSessionId !== null && context.forkSession ? { forkSession: true } : {}),
      // Cap the turn's token budget when the user set one; the SDK sends it as the API-side task
      // budget so the model paces its tool use and wraps up before the limit.
      ...(context.tokenCap > 0 ? { taskBudget: { total: context.tokenCap } } : {}),
      ...this.executableOption(),
      ...(this.runEnv(context.auth) ?? {}),
    };

    // Mid-run steering rides the SDK's streaming-input mode: the prompt is an async generator that
    // yields the initial message and then any user messages the user injects while the run executes
    // (each becomes a further turn in the same run). After a completed response cycle (a `result`
    // message) with nothing further queued, the input closes and the run ends — identical to the
    // single-turn behaviour when the user never steers.
    const pendingSteers: string[] = [];
    let wake: (() => void) | null = null;
    let inputClosed: boolean = false;
    const closeInput: () => void = (): void => {
      inputClosed = true;
      context.setSteerHandler(null);
      wake?.();
    };
    context.setSteerHandler((steered: string): boolean => {
      if (inputClosed) {
        return false;
      }
      pendingSteers.push(steered);
      wake?.();
      return true;
    });
    context.signal.addEventListener('abort', closeInput, { once: true });
    const initialPrompt: string = buildRunPrompt(context);
    const userMessage: (value: string) => SDKUserMessage = (value: string): SDKUserMessage => ({
      type: 'user',
      message: { role: 'user', content: value },
      parent_tool_use_id: null,
    });
    // Attached images ride the initial message as image blocks ahead of the prompt text; steered
    // follow-ups are text-only.
    const initialMessage: SDKUserMessage =
      context.images.length === 0
        ? userMessage(initialPrompt)
        : {
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
                { type: 'text', text: initialPrompt },
              ],
            } as SDKUserMessage['message'],
            parent_tool_use_id: null,
          };
    async function* promptStream(): AsyncGenerator<SDKUserMessage> {
      yield initialMessage;
      while (true) {
        const next: string | undefined = pendingSteers.shift();
        if (next !== undefined) {
          yield userMessage(next);
          continue;
        }
        if (inputClosed) {
          return;
        }
        await new Promise<void>((resolve: () => void): void => {
          wake = resolve;
        });
        wake = null;
      }
    }

    const response: Query = query({ prompt: promptStream(), options });
    let reportedSessionId: string | null = null;
    // A steered run sees several `result` messages whose reported cost is cumulative; this tracks the
    // last total (so each usage event carries only that turn's cost delta) and the last top-level
    // assistant message's usage (so the context meter reads the true window occupancy, not the result's
    // cumulative token total).
    const usageState: RunUsageState = { lastCostUsd: 0, lastAssistantUsage: null };
    try {
      for await (const message of response) {
        if (context.signal.aborted) {
          break;
        }
        // Surface the SDK session id so the renderer can resume this conversation on its next turn.
        // Every message carries it; report it once (and again if it ever changes, e.g. a forked
        // resume).
        const sessionId: string | null = this.sessionIdOf(message);
        if (sessionId !== null && sessionId !== reportedSessionId) {
          reportedSessionId = sessionId;
          context.emit({ requestId: context.requestId, kind: 'session', sessionId });
        }
        this.handleMessage(message, context, usageState);
        // A turn boundary with nothing further queued ends the run. Closing the input in the same
        // tick as the check keeps this race-free: once closed, a late steer is refused and the
        // renderer queues the message for the next run instead.
        if (message.type === 'result' && pendingSteers.length === 0) {
          closeInput();
          break;
        }
      }
    } finally {
      closeInput();
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
    // Every surface learns it can ask the user questions instead of guessing.
    const withAsk: string = `${base}\n\n${ASK_USER_PROMPT_APPENDIX}`;
    return readOnly ? `${withAsk}\n\n${READ_ONLY_APPENDIX}` : withAsk;
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
