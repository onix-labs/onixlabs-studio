import { inject, Service } from '@angular/core';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { Log } from '@shared/angular/services/log/log';
import { AiConnection } from '@shared/api/ai/ai-connection-types';
import { AiModelInfo } from '@shared/api/ai/ai-provider-types';
import { ModelDetails } from '@shared/api/model-runtime-types';
import { ModelRuntimes } from '../model-runtime/model-runtimes';

/**
 * The context window assumed for a local model whose metadata does not report one. Deliberately
 * conservative: the token readout's denominator being too small shows the conversation as fuller than
 * it is, which is far less damaging than the opposite.
 */
const FALLBACK_CONTEXT_WINDOW: number = 8_192;

/**
 * Keeps the Ollama *connections* in step with the models the manager installs.
 *
 * This is the one place the two halves of the AI Model Manager's boundary meet. The manager owns the
 * runtime and the weights; connections (#254) own endpoint configuration and which model ids reach the
 * agent picker. Pulling a model here writes its id into the connection there, so a model becomes
 * usable without a detour through Settings — and removing it takes the id back out again.
 *
 * Two deliberate limits:
 *
 * - It only touches connections of kind `ollama` that carry **no explicit base URL**, because those
 *   are the ones resolving to the local server this manager controls. A connection pointed at another
 *   host must not gain a model that only exists on this machine.
 * - It acts **only on the user's explicit install and remove**, never as a background reconciliation.
 *   Sweeping the installed list into the connection on every refresh would silently undo a user who
 *   deliberately hid or removed a model from their picker. Models installed outside Studio are the
 *   existing model-discovery flow's job, not this one's.
 */
@Service()
export class ModelConnections {
  /**
   * Holds the connection registry the models are written into.
   */
  private readonly connections: AiConnections = inject(AiConnections);

  /**
   * Holds the runtime client, used to read a model's metadata.
   */
  private readonly runtimes: ModelRuntimes = inject(ModelRuntimes);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Adds a freshly-installed model to every local Ollama connection that does not already list it,
   * carrying its real context window across from the runtime's metadata.
   * @param name The fully-qualified model reference, as the runtime lists it.
   * @returns Returns a promise that resolves once the connections are updated.
   */
  public async linkInstalled(name: string): Promise<void> {
    const targets: readonly AiConnection[] = this.localOllamaConnections();
    if (targets.length === 0) {
      this.log.debug(
        'model-manager.connections',
        `No local Ollama connection to add '${name}' to; skipping`,
      );
      return;
    }

    // `/api/show` is the only place the context window is available, and it costs a round trip, so it
    // is read once here rather than per connection.
    const details: ModelDetails | null = await this.runtimes.show(name);
    const model: AiModelInfo = {
      id: name,
      label: name,
      contextWindow: details?.contextLength ?? FALLBACK_CONTEXT_WINDOW,
    };

    for (const connection of targets) {
      if (connection.models.some((existing: AiModelInfo): boolean => existing.id === name)) {
        continue;
      }
      this.log.info(
        'model-manager.connections',
        `Adding '${name}' to connection '${connection.id}' (context ${model.contextWindow})`,
      );
      this.connections.update(connection.id, { models: [...connection.models, model] });
    }
  }

  /**
   * Removes a model from every local Ollama connection that lists it, so the picker stops offering a
   * model whose weights are gone.
   * @param name The fully-qualified model reference.
   */
  public unlinkRemoved(name: string): void {
    for (const connection of this.localOllamaConnections()) {
      if (!connection.models.some((existing: AiModelInfo): boolean => existing.id === name)) {
        continue;
      }
      this.log.info(
        'model-manager.connections',
        `Removing '${name}' from connection '${connection.id}'`,
      );
      this.connections.removeModel(connection, name);
    }
  }

  /**
   * Gets the connections that resolve to the local Ollama server this manager controls: kind `ollama`,
   * with no explicit base URL pointing them somewhere else.
   * @returns Returns the matching connections.
   */
  private localOllamaConnections(): readonly AiConnection[] {
    return this.connections
      .connections()
      .filter(
        (connection: AiConnection): boolean =>
          connection.kind === 'ollama' &&
          (connection.baseUrl === undefined || connection.baseUrl.trim().length === 0),
      );
  }
}
