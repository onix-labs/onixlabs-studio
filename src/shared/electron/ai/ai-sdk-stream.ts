import type { ToolSet } from 'ai';
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
  type AgentSurface,
  type AiInputChoice,
  type AiToolPolicy,
  type InsertPlacement,
} from '@shared/api/ai-types';
import type { AgentRunContext } from './agent-provider';
import {
  ASK_USER_DESCRIPTION,
  ASK_USER_PROMPT_APPENDIX,
  BINARY_PROMPT_APPENDIX,
  PROJECT_PROMPT_APPENDIX,
  STUDIO_PROMPT_APPENDIX,
  TERMINAL_PROMPT_APPENDIX,
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
  setActiveDocumentLanguage,
  writeBinaryAssembly,
  writeTerminalInput,
  READ_ONLY_APPENDIX,
} from './studio-tools';
import { formatToolInput, formatToolOutput, summarizeToolInput } from './tool-format';
import { coarseGrantSource } from './tool-policy';

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
 * Drives an AI-SDK `fullStream` to completion, mapping each part to the shared event protocol and
 * stopping early when the run is aborted. Critically, an `error` part is thrown rather than ignored:
 * the SDK reports request/stream failures (an unreachable server, an unknown model, a refused
 * connection) as a part, not an exception, so swallowing it would end a failed run silently.
 * @param stream The SDK `fullStream`.
 * @param context The run context to emit through.
 */
export async function consumeAgentStream(
  stream: AsyncIterable<StreamPart>,
  context: AgentRunContext,
): Promise<void> {
  for await (const part of stream) {
    if (context.signal.aborted) {
      return;
    }
    if (part.type === 'error') {
      throw new Error(describeRunError(part.error));
    }
    mapStreamPart(part, context);
  }
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
      }),
      execute: (args: { question: string; choices?: AiInputChoice[] }): Promise<string> =>
        askUser(context, args.question, args.choices ?? []),
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
 * @returns Returns the wrapped executor.
 */
function gated<TArgs>(
  context: AgentRunContext,
  name: string,
  execute: (args: TArgs) => Promise<string>,
): (args: TArgs) => Promise<string> {
  return async (args: TArgs): Promise<string> => {
    // Per-tool default policy (#309), consulted ahead of the posture: `deny` refuses, `allow` runs
    // without prompting, and an unset tool (or `ask`) falls through to the posture/prompt below.
    const detail: string = summarizeToolInput(args);
    const policy: AiToolPolicy = context.toolPolicies[name] ?? 'ask';
    if (policy === 'deny') {
      return `The ${name} tool is set to Deny in your agent settings.`;
    }
    if (policy !== 'allow' && context.permissionPosture !== 'auto-all') {
      const granted: boolean = await context.requestPermission(name, detail);
      if (!granted) {
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
  const readTool: ToolSet = {
    [READ_ACTIVE_DOCUMENT]: tool({
      description: "Read the active editor document's full text.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => readActiveDocument(context),
    }),
  };
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
 * Selects the system-prompt appendix for a run: the terminal, binary, or (default) editor surface
 * guidance, plus the ask-user guidance every surface carries, plus the read-only note on a chat-mode
 * run. Shared by the AI-SDK-backed providers so the run-to-prompt mapping lives in one place and
 * matches the Claude path.
 * @param context The run context (carries the surface and mode).
 * @returns Returns the prompt appendix text.
 */
export function promptForSurface(context: AgentRunContext): string {
  const surface: AgentSurface = context.surface;
  const base: string = ((): string => {
    switch (surface) {
      case 'terminal':
        return TERMINAL_PROMPT_APPENDIX;
      case 'binary':
        return BINARY_PROMPT_APPENDIX;
      case 'project':
        return PROJECT_PROMPT_APPENDIX;
      case 'editor':
        return STUDIO_PROMPT_APPENDIX;
    }
  })();
  const withAsk: string = `${base}\n\n${ASK_USER_PROMPT_APPENDIX}`;
  return context.mode === 'chat' ? `${withAsk}\n\n${READ_ONLY_APPENDIX}` : withAsk;
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
  const surfaceTools: ToolSet = await ((): Promise<ToolSet> => {
    switch (context.surface) {
      case 'terminal':
        return createTerminalTools(context);
      case 'binary':
        return createBinaryTools(context);
      // The standalone agent has no owning document and the AI-SDK providers have no built-in tools,
      // so a project run carries only the ask-user tool (a documented limitation of those providers).
      case 'project':
        return Promise.resolve({});
      case 'editor':
        return createStudioTools(context);
    }
  })();
  return { ...askUserTool, ...surfaceTools };
}

/**
 * Maps a single Vercel AI SDK `fullStream` part to the shared event protocol, emitting through the run
 * context. Shared by every AI-SDK-backed provider so the stream-to-event translation lives in one
 * place.
 * @param part The stream part.
 * @param context The run context to emit through.
 */
export function mapStreamPart(part: StreamPart, context: AgentRunContext): void {
  const requestId: string = context.requestId;
  switch (part.type) {
    case 'text-delta':
      context.emit({ requestId, kind: 'text', delta: part.text ?? part.delta ?? '' });
      break;
    case 'reasoning-delta':
      context.emit({ requestId, kind: 'thinking', delta: part.text ?? part.delta ?? '' });
      break;
    case 'tool-call': {
      const input: string | undefined = formatToolInput(part.input);
      context.emit({
        requestId,
        kind: 'tool-start',
        toolId: part.toolCallId ?? '',
        name: part.toolName ?? 'tool',
        detail: typeof part.input === 'string' ? part.input : summarizeToolInput(part.input),
        ...(input === undefined ? {} : { input }),
      });
      break;
    }
    case 'tool-result': {
      const output: string | undefined = formatToolOutput(part.output);
      context.emit({
        requestId,
        kind: 'tool-end',
        toolId: part.toolCallId ?? '',
        ok: true,
        detail: 'done',
        ...(output === undefined ? {} : { output }),
      });
      break;
    }
    case 'tool-error':
      context.emit({
        requestId,
        kind: 'tool-end',
        toolId: part.toolCallId ?? '',
        ok: false,
        detail: part.errorText ?? 'failed',
        ...(part.errorText === undefined || part.errorText.length === 0
          ? {}
          : { output: part.errorText }),
      });
      break;
    case 'finish': {
      // The terminal `finish` part carries the run's cumulative usage; the AI-SDK providers do not
      // report a cost, so it is left unknown.
      const usage: StreamPart['totalUsage'] = part.totalUsage;
      if (usage !== undefined) {
        context.emit({
          requestId,
          kind: 'usage',
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          costUsd: null,
        });
      }
      break;
    }
    default:
      break;
  }
}
