import type { NodeRuntimeSpec } from './contributions/plugins/plugin-loader';

/**
 * Says how to run a plugin's JavaScript entry point under the runtime Studio ships: Electron's own
 * binary in Node mode, so a plugin process needs no Node on the machine. Shared by every slot whose
 * plugins Studio spawns and speaks a protocol to — version control, hosting, container engines.
 * @param entryPoint The installed entry point.
 * @returns Returns the command, arguments and environment.
 */
export function pluginNodeRuntime(entryPoint: string): NodeRuntimeSpec {
  return { command: process.execPath, args: [entryPoint], env: { ELECTRON_RUN_AS_NODE: '1' } };
}
