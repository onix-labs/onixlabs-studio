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
  READ_ACTIVE_DOCUMENT,
  REPLACE_ACTIVE_DOCUMENT,
  type AiModelInfo,
  type AiPermissionPosture,
  type AiProviderId,
  type AiVerifyResult,
} from '../../shared/ai-types';
import type { AgentAuth, AgentProvider, AgentRunContext, ProviderAvailability } from './agent-provider';
import type { AiCredential } from './ai-auth-manager';
import { resolveBundledClaudeExecutable } from './claude-executable';
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL } from './models';
import {
  READ_TOOL_FQN,
  REPLACE_TOOL_FQN,
  STUDIO_PROMPT_APPENDIX,
  readActiveDocument,
  replaceActiveDocument,
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
 * Holds the built-in file-editing tools auto-allowed under the `auto-edits` permission posture.
 */
const EDIT_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

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

    // Expose Studio's in-app editor capabilities as an in-process MCP server; the tool handlers call
    // back into the renderer over the run context's bridge.
    const studioServer: McpSdkServerConfigWithInstance = createSdkMcpServer({
      name: 'studio',
      version: '0.0.0',
      tools: [
        tool(
          READ_ACTIVE_DOCUMENT,
          "Read the active editor document's full text.",
          {},
          async (): Promise<{ content: { type: 'text'; text: string }[] }> => ({
            content: [{ type: 'text', text: await readActiveDocument(context) }],
          }),
        ),
        tool(
          REPLACE_ACTIVE_DOCUMENT,
          "Replace the active editor document's entire text.",
          { text: z.string().describe('The new full text of the document.') },
          async (args: {
            text: string;
          }): Promise<{ content: { type: 'text'; text: string }[] }> => ({
            content: [{ type: 'text', text: await replaceActiveDocument(context, args.text) }],
          }),
        ),
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
      systemPrompt: { type: 'preset', preset: 'claude_code', append: STUDIO_PROMPT_APPENDIX },
      mcpServers: { studio: studioServer },
      // Auto-allow the in-app editor tools (the user sees and can undo the change) and read-only
      // project exploration; canUseTool gates everything else.
      allowedTools: [READ_TOOL_FQN, REPLACE_TOOL_FQN, ...(hasWorkspace ? READ_ONLY_TOOLS : [])],
      canUseTool,
      abortController: controller,
      // Cap the turn's token budget when the user set one; the SDK sends it as the API-side task
      // budget so the model paces its tool use and wraps up before the limit.
      ...(context.tokenCap > 0 ? { taskBudget: { total: context.tokenCap } } : {}),
      ...this.executableOption(),
      ...(this.runEnv(context.auth) ?? {}),
    };

    const response: Query = query({ prompt: context.prompt, options });
    for await (const message of response) {
      if (context.signal.aborted) {
        break;
      }
      this.handleMessage(message, context);
    }
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
