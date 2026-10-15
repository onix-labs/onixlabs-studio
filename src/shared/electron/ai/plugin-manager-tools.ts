import {
  INSTALL_PLUGIN,
  LIST_PLUGINS,
  READ_WORKSPACE_LANGUAGES,
  UNINSTALL_PLUGIN,
} from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
import type { AgentRunContext } from './agent-provider';

// The Plugin Manager agent's tools (#968). The renderer acts through the same Plugins service the
// view's buttons use, so an install raises the very consent window a click would — the agent can
// never install without the user accepting the plugin's terms.

/**
 * Appended to the system prompt for a Plugin Manager run, so the model knows what it is docked to,
 * what it can reach, and what it is not for.
 */
export const PLUGIN_MANAGER_PROMPT_APPENDIX: string = [
  'You are running inside ONIXLabs Studio, docked to the Plugin Manager: the language servers,',
  'debuggers, decoders, version control, hosting, container engines and agent providers the user can',
  'add to Studio. You can:',
  `- "${LIST_PLUGINS}" lists the plugins — installed, available, and waiting updates — with what each`,
  '  one contributes and which languages it serves.',
  `- "${READ_WORKSPACE_LANGUAGES}" reports the user's open workspaces, their ecosystems, and the`,
  '  languages those imply.',
  `- "${INSTALL_PLUGIN}" installs a plugin, or updates one. Studio shows the user its terms first and`,
  '  installs only if they accept.',
  `- "${UNINSTALL_PLUGIN}" uninstalls a plugin.`,
  'Recommending: read the workspaces and the plugins, then suggest what serves the languages the user',
  'works in and is not installed yet — say why each one, briefly. Install only what the user agrees to;',
  'one at a time, since each install asks them to accept its terms.',
  'Uninstall only when the user asks, and say what stops working without it.',
  'You are kept to this view. You cannot read or change files, run commands, or act anywhere else in',
  'Studio. When the user asks for something outside it, say which part of Studio can help instead.',
].join('\n');

/**
 * Asks the renderer for something and renders the answer for the model.
 * @param context The agent run context (carries the bridge).
 * @param name The capability.
 * @param input What to send.
 * @param done How to describe a success, given the answer.
 * @returns Returns the rendered answer.
 */
async function ask(
  context: AgentRunContext,
  name: string,
  input: Record<string, unknown>,
  done: (answer: Record<string, unknown>) => string = (answer: Record<string, unknown>): string =>
    JSON.stringify(answer['result'] ?? {}, null, 2),
): Promise<string> {
  logger.trace('PluginManagerTools', `Tool invoked: ${name}`);
  const result: unknown = await context.bridge.request(name, input);
  const answer: Record<string, unknown> =
    result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  if (answer['available'] !== true) {
    return 'The Plugin Manager is not open, so it cannot be reached.';
  }
  if (typeof answer['error'] === 'string') {
    logger.debug('PluginManagerTools', `${name} refused: ${answer['error']}`);
    return answer['error'];
  }
  return done(answer);
}

/**
 * Lists the plugins.
 * @param context The agent run context.
 * @param filter Which plugins to list.
 * @returns Returns the plugins.
 */
export function listPlugins(context: AgentRunContext, filter: string | undefined): Promise<string> {
  return ask(context, LIST_PLUGINS, { filter: filter ?? 'all' });
}

/**
 * Reports the open workspaces' ecosystems and languages.
 * @param context The agent run context.
 * @returns Returns the workspaces.
 */
export function readWorkspaceLanguages(context: AgentRunContext): Promise<string> {
  return ask(context, READ_WORKSPACE_LANGUAGES, {});
}

/**
 * Installs or updates a plugin, through the consent window.
 * @param context The agent run context.
 * @param id The plugin's id.
 * @returns Returns what happened.
 */
export function installPlugin(context: AgentRunContext, id: string): Promise<string> {
  return ask(context, INSTALL_PLUGIN, { id }, (answer: Record<string, unknown>): string => {
    switch (answer['outcome']) {
      case 'installed':
        return `Installed ${id}${typeof answer['version'] === 'string' ? ` ${answer['version']}` : ''}.`;
      case 'declined':
        return `The user did not accept ${id}'s terms, so nothing was installed.`;
      default:
        return `${id} could not be installed${typeof answer['reason'] === 'string' ? `: ${answer['reason']}` : '.'}`;
    }
  });
}

/**
 * Uninstalls a plugin.
 * @param context The agent run context.
 * @param id The plugin's id.
 * @returns Returns what happened.
 */
export function uninstallPlugin(context: AgentRunContext, id: string): Promise<string> {
  return ask(context, UNINSTALL_PLUGIN, { id }, (): string => `Uninstalled ${id}.`);
}
