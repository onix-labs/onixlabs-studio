import {
  LocalModel,
  ModelDetails,
  ModelRuntimeStatus,
  RunningModel,
} from '@shared/api/model-runtime-types';

/**
 * A local AI model runtime — the provider slot the AI Model Manager is built against, so the manager
 * never names Ollama. An implementation owns one runtime's native API and maps it into the normalised
 * `@shared/api/model-runtime-types` shapes.
 *
 * This is the read surface: enumerating installed and running models, inspecting one, and removing
 * one. Server lifecycle (detect, provision, start, stop) is added by #410 and pulling by #411, both of
 * which extend this interface rather than replacing it.
 *
 * Every operation is server-absent-safe by contract: when the runtime is not running, a query resolves
 * to an empty result, a null, or an unavailable status — never a throw. The manager view is expected
 * to render "not running" as a normal state, not as an error, because it is the state the user is
 * there to fix.
 */
export interface ModelRuntime {
  /**
   * Gets the stable runtime identifier (for example `ollama`).
   */
  readonly id: string;

  /**
   * Gets the human-readable runtime name, for display in the manager.
   */
  readonly displayName: string;

  /**
   * Reports whether the runtime's server is reachable, and its version when it is.
   * @returns Returns the runtime status.
   */
  status(): Promise<ModelRuntimeStatus>;

  /**
   * Lists the models installed locally.
   * @returns Returns the installed models, or an empty list when the runtime is unreachable.
   */
  list(): Promise<LocalModel[]>;

  /**
   * Lists the models currently loaded into memory.
   * @returns Returns the running models, or an empty list when the runtime is unreachable.
   */
  running(): Promise<RunningModel[]>;

  /**
   * Reads one model's detailed metadata.
   * @param name The fully-qualified model reference.
   * @returns Returns the details, or null when the model is not installed or the runtime is unreachable.
   */
  show(name: string): Promise<ModelDetails | null>;

  /**
   * Removes an installed model, deleting its weights.
   * @param name The fully-qualified model reference.
   * @returns Returns true when the runtime accepted the request.
   */
  remove(name: string): Promise<boolean>;
}
