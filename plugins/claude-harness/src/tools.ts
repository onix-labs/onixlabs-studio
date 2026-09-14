// Studio's own tools, exposed to the model as an in-process MCP server.
//
// 🔑 **This is the piece that makes the port ~700 lines shorter than the provider it replaces**, and it
// is not a shortcut — it is the A5 ruling working as intended. The in-core provider declared all
// twenty-eight of Studio's tools inline, with their descriptions and Zod schemas, duplicating what
// `studio-tools.ts` already held. Core now answers a `tools` request with those descriptions, so this
// plugin asks for them instead of restating them. Adding a twenty-ninth Studio capability reaches
// every harness at once, rather than requiring each one to be republished.
//
// 🔑 **The conversion that did not need writing.** Studio sends each tool's input shape as JSON Schema,
// and MCP's own `tools/list` carries JSON Schema — so the two meet exactly. The SDK's `tool()` helper
// would have wanted a Zod shape and forced a JSON-Schema-to-Zod converter (a dependency, and a lossy
// one); going one level down to the MCP `Server`'s request handlers avoids the round trip entirely.
//
// ⛔ **Execution never happens here.** A `tools/call` becomes a `tool` request back to Studio, which
// runs the implementation, applies the user's per-tool policy, raises the permission prompt and writes
// the audit record. That is the whole point: a plugin cannot grant itself a capability, and the user's
// settings are enforced where the user set them.
//
// ⚠️ One consequence worth stating, because it is a real difference from the in-core provider. Studio
// raises the prompt for its own tools, so those prompts are **not** raced against a claude.ai peer
// under remote control — only the SDK's built-in tools (Bash, Edit, Read, …) are, since those are the
// ones this harness gates itself. Accepted deliberately: the alternative is moving the permission gate
// into the plugin, and Studio's in-app tools act on this machine's windows anyway.

import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { note } from './log';
import type { StudioTool } from './protocol';

/**
 * The MCP server name Studio's tools are registered under. It decides their fully-qualified names —
 * `mcp__studio__read_active_document` and so on — which the permission gate and the transcript both
 * match against, so it is not free to change.
 */
export const STUDIO_SERVER: string = 'studio';

/**
 * The prefix a fully-qualified Studio tool name carries.
 */
export const STUDIO_TOOL_PREFIX: string = `mcp__${STUDIO_SERVER}__`;

/**
 * How this harness reaches Studio for the tools and for running one.
 */
export interface ToolBridge {
  /**
   * Asks Studio what it offers for the turn in flight.
   * @returns Returns the tools and the instructions describing them.
   */
  describe(): Promise<{ tools: readonly StudioTool[]; systemPrompt: string }>;

  /**
   * Asks Studio to run one of its tools.
   * @param name The tool to run.
   * @param input The arguments the model supplied.
   * @returns Returns the result, or the reason it could not run.
   */
  invoke(name: string, input: unknown): Promise<{ result: string | null; error: string | null }>;
}

/**
 * Builds the in-process MCP server that exposes Studio's tools to the model.
 *
 * ⚠️ `tools/list` asks Studio **every time it is called** rather than caching, because the offer is
 * per-turn: it depends on the surface and on whether the turn may act, and a tool the user has since
 * set to Deny must stop being listed. {@link refresh} nudges the CLI to re-list at each turn so a
 * change lands without waiting for a reconnect.
 * @param bridge How to reach Studio.
 * @returns Returns the server config to pass as `mcpServers.studio`, and a way to nudge a re-list.
 */
export function createStudioToolServer(bridge: ToolBridge): {
  readonly config: McpSdkServerConfigWithInstance;
  readonly refresh: () => void;
} {
  const server: McpServer = new McpServer(
    { name: STUDIO_SERVER, version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } } },
  );
  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const offer: { tools: readonly StudioTool[] } = await bridge.describe();
    return {
      tools: offer.tools.map(
        (tool: StudioTool): { name: string; description: string; inputSchema: unknown } => ({
          name: tool.name,
          description: tool.description,
          // Straight through. Studio converted its Zod schema once, on its own side, and a second
          // conversion here could only disagree with it — which shows up as a model calling a tool
          // with arguments Studio then rejects.
          inputSchema: tool.inputSchema,
        }),
      ),
    };
  });
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name: string = request.params.name;
    const outcome: { result: string | null; error: string | null } = await bridge.invoke(
      name,
      request.params.arguments ?? {},
    );
    if (outcome.error !== null) {
      // Reported as a tool error rather than thrown: the model should see that this particular call
      // failed and be able to do something else, not have the turn collapse. A refused permission
      // arrives here too, and "the user declined" is information the model can act on.
      return { content: [{ type: 'text', text: outcome.error }], isError: true };
    }
    return { content: [{ type: 'text', text: outcome.result ?? '' }] };
  });
  return {
    // ⚠️ The cast is the one place this file is not honest with the compiler, and it is worth saying
    // why. `@modelcontextprotocol/sdk` ships both a CommonJS and an ESM build. This plugin bundles to
    // CommonJS, so its `McpServer` comes from the CJS build; the Agent SDK is ESM and its published
    // types name the ESM one. They are the same class from the same package, compiled twice, and
    // TypeScript treats the two as unrelated because each declares its own private fields.
    //
    // ⛔ Nothing structural is being papered over: the Agent SDK only ever calls methods on this
    // instance, so two class identities are indistinguishable at runtime. The alternative — shipping
    // this plugin as ESM — would break the bundle, because the SDK's own CLI resolution needs
    // `createRequire`, which throws under an ESM bundle.
    config: {
      type: 'sdk',
      name: STUDIO_SERVER,
      instance: server,
    } as unknown as McpSdkServerConfigWithInstance,
    refresh: (): void => {
      try {
        server.sendToolListChanged();
      } catch (error: unknown) {
        // Only possible before the CLI has connected to the server, where there is nothing to tell.
        note(`tools: could not announce a tool-list change: ${String(error)}`);
      }
    },
  };
}
