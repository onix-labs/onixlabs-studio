import type { OllamaStopOnQuit } from '@shared/api/startup-settings';
import { StartupPreferencesStore } from '../startup-preferences';

/**
 * Lays the user's Ollama settings over an environment, for everything that resolves the server from
 * one. What the environment already names wins: the setting is the default for someone who exported
 * nothing, and the settings page says so.
 * @param env The environment.
 * @returns Returns the environment to resolve from.
 */
export function ollamaEnvironment(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const { ollamaAddress, ollamaModelsFolder } = StartupPreferencesStore.read().settings;
  return {
    ...env,
    ...(env['OLLAMA_HOST'] === undefined && ollamaAddress !== ''
      ? { OLLAMA_HOST: ollamaAddress }
      : {}),
    ...(env['OLLAMA_MODELS'] === undefined && ollamaModelsFolder !== ''
      ? { OLLAMA_MODELS: ollamaModelsFolder }
      : {}),
  };
}

/**
 * Gets the `keep_alive` the user wants for loaded models, in Ollama's own form.
 * @returns Returns a duration such as `5m`, or `-1` for as long as the server runs.
 */
export function ollamaKeepAlive(): string {
  const minutes: number = StartupPreferencesStore.read().settings.ollamaKeepAliveMinutes;
  return minutes < 0 ? '-1' : `${minutes}m`;
}

/**
 * Gets what the user wants done with a server Studio started, when Studio quits.
 * @returns Returns the policy.
 */
export function ollamaStopOnQuit(): OllamaStopOnQuit {
  return StartupPreferencesStore.read().settings.ollamaStopOnQuit;
}

/**
 * Starts the runtime for a model about to be used, when something has registered to do so.
 */
let demandHandler: (() => Promise<void>) | null = null;

/**
 * Registers what starts the runtime when a model is about to be used.
 * @param handler Starts it, or null to forget it.
 */
export function onOllamaNeeded(handler: (() => Promise<void>) | null): void {
  demandHandler = handler;
}

/**
 * Says a model is about to be used, so the runtime starts when the user wants it started on demand.
 * Never rejects: a runtime that cannot start is reported by the request that needed it.
 * @returns Returns a promise resolving once it has had the chance to start.
 */
export async function ollamaNeeded(): Promise<void> {
  await demandHandler?.().catch((): void => undefined);
}
