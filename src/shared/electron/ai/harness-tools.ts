import { ASK_USER, type AiToolPolicy } from '@shared/api/ai-types';
import type { HarnessTool } from '@shared/api/agent-protocol';
import { logger } from '@shared/electron/logger';
import type { AgentRunContext } from './agent-provider';
import { promptForSurface, toolsForSurface } from './ai-sdk-stream';

// Studio's own tools, described to a harness and run on its behalf (#653).
//
// A harness whose model brings its own tools — Claude's SDK and Codex's both do — never comes here. One
// that talks to a plain model API has none, so Studio supplies them, and that is what makes Ollama and
// every OpenAI-compatible endpoint reachable as a plugin at all.
//
// ⛔ **Descriptions cross the wire; execution never does.** The harness learns that a tool exists and
// what it takes, then asks Studio to run it. So the implementation, the permission gate and the audit
// record stay on Studio's side — which is where the user's settings are, and the only place enforcing
// them means anything. A plugin cannot grant itself a capability by describing one.
//
// 🔑 Nothing here re-implements policy. The tools `toolsForSurface` returns are already wrapped by
// `gated`, which refuses a denied tool, prompts under an `ask` policy and writes the audit record at the
// moment of execution. Invoking one by name gets all of that for free; re-deriving it here would be a
// second opinion about the user's permissions, which is the last thing this should have.

/**
 * The tool set shape `toolsForSurface` returns, narrowed to what this module uses.
 *
 * Declared locally rather than imported from the AI SDK, whose `ToolSet` is generic over things this
 * does not care about: all that is needed here is a description, a schema and something to run.
 */
interface ToolLike {
  /**
   * Gets the description shown to the model.
   */
  readonly description?: string;

  /**
   * Gets the Zod schema for the tool's input.
   */
  readonly inputSchema?: unknown;

  /**
   * Runs the tool. Already wrapped by `gated`, so this is the point at which policy applies.
   */
  readonly execute?: (input: unknown) => Promise<unknown>;
}

/**
 * Caches the tool set per turn.
 *
 * Keyed by the run context, which makes the lifetime exactly right without any plumbing: a context is
 * one turn, so the set is built at most once per turn and released with it. Building it is not free —
 * it dynamically imports the AI SDK and Zod and constructs ~28 schemas — and a model that calls six
 * tools would otherwise pay for it six times.
 *
 * ⚠️ A `WeakMap` rather than a `Map`: a turn that ends without asking for a tool must not keep its
 * context alive.
 */
const byTurn: WeakMap<AgentRunContext, Promise<Record<string, ToolLike>>> = new WeakMap<
  AgentRunContext,
  Promise<Record<string, ToolLike>>
>();

/**
 * Builds (or reuses) the tool set for a turn.
 * @param context The run context.
 * @returns Returns the tools, keyed by name.
 */
async function toolsFor(context: AgentRunContext): Promise<Record<string, ToolLike>> {
  let pending: Promise<Record<string, ToolLike>> | undefined = byTurn.get(context);
  if (pending === undefined) {
    // `toolsForSurface` itself imports the AI SDK and Zod dynamically, inside the call, so nothing
    // heavy is loaded until a harness actually asks for a tool. Everything is bundled into one file
    // regardless, so importing it statically here costs module evaluation order and nothing else.
    pending = toolsForSurface(context) as Promise<Record<string, ToolLike>>;
    byTurn.set(context, pending);
  }
  return pending;
}

/**
 * Describes what Studio offers a harness for a turn: its instructions, and the tools they describe.
 *
 * ⛔ A tool the user set to **Deny** is omitted entirely rather than listed and refused — the model is
 * never told it exists. The accepted cost, recorded because it is a real one: a model that cannot see a
 * capability may work around it or fail without explaining itself, where one told "that is switched off"
 * could have said so. That was the ruling, and the alternative was a denial the model can keep pushing
 * against.
 * @param context The run context.
 * @returns Returns the tool descriptions.
 */
export async function describeOffer(
  context: AgentRunContext,
  omit: readonly string[] = [],
): Promise<{ systemPrompt: string; tools: readonly HarnessTool[] }> {
  const tools: Record<string, ToolLike> = await toolsFor(context);
  const { z } = await import('zod');
  const described: HarnessTool[] = [];
  for (const [name, tool] of Object.entries(tools)) {
    // A tool the harness already has (protocol 1.9.0). Sending it anyway would hand the model two ways
    // to do one thing, described differently — and a model given both picks either, so the behaviour
    // of asking the user would depend on which description it happened to read first.
    if (omit.includes(name)) {
      continue;
    }
    const policy: AiToolPolicy | undefined = context.toolPolicies[name];
    if (policy === 'deny') {
      continue;
    }
    described.push({
      name,
      description: typeof tool.description === 'string' ? tool.description : name,
      // Converted rather than authored twice. Two hand-written descriptions of the same shape drift,
      // and the drift shows up as a model calling a tool with arguments Studio then rejects.
      inputSchema: z.toJSONSchema(tool.inputSchema as Parameters<typeof z.toJSONSchema>[0]),
    });
  }
  logger.debug(
    'harness-tools.describeOffer',
    `Described ${described.length} of ${Object.keys(tools).length} tool(s) for ${context.surface}`,
  );
  // The instructions travel with the tools because they describe them: what this surface is, how to use
  // them, and that a chat turn may read but not act. A harness left to write its own would be a second
  // description of one set of capabilities.
  //
  // 🔑 Phrased for the tools actually offered, which is the whole reason `omit` says what the harness
  // *has* rather than what to withhold. A harness with its own clarifying-question tool still needs the
  // model told to ask rather than guess — it just must not be pointed at a Studio tool that is no
  // longer in its list, because a model told to call a tool it cannot see either invents one or
  // silently guesses instead.
  return {
    systemPrompt: promptForSurface(context, { nativeAsk: omit.includes(ASK_USER) }),
    tools: described,
  };
}

/**
 * Runs one of Studio's tools on a harness's behalf.
 *
 * 🔑 The policy gate and the audit record live inside the tool's own `execute`, put there by `gated`.
 * This does not re-derive either: a second opinion about the user's permissions is precisely the thing
 * that would let the two disagree.
 * @param context The run context.
 * @param name The tool to run.
 * @param input The arguments the model supplied.
 * @returns Returns the result, or the reason it could not run.
 */
export async function invokeTool(
  context: AgentRunContext,
  name: string,
  input: unknown,
): Promise<{ result: string | null; error: string | null }> {
  const tools: Record<string, ToolLike> = await toolsFor(context);
  const tool: ToolLike | undefined = tools[name];
  if (tool?.execute === undefined) {
    // A harness asking for a tool that was never described is either confused or trying its luck.
    // Either way the honest answer names the tool rather than pretending it ran.
    logger.warn('harness-tools.invokeTool', `A harness asked for the unknown tool '${name}'`);
    return { result: null, error: `Studio has no tool called '${name}'.` };
  }
  // ⛔ Checked again even though a denied tool was never described. Withholding it is what stops the
  // model reaching for it; this is what stops a harness reaching past the list it was given.
  if (context.toolPolicies[name] === 'deny') {
    return { result: null, error: `The ${name} tool is set to Deny in your agent settings.` };
  }
  try {
    const result: unknown = await tool.execute(input);
    return { result: typeof result === 'string' ? result : JSON.stringify(result), error: null };
  } catch (error: unknown) {
    return { result: null, error: error instanceof Error ? error.message : String(error) };
  }
}
