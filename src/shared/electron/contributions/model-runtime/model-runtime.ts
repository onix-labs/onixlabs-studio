import {
  LocalModel,
  ModelDetails,
  ModelDiskUsage,
  ModelRuntimeStatus,
  RunningModel,
  RuntimeInstallation,
  RuntimeInstallProgress,
} from '@shared/api/model-runtime-types';

/**
 * A local AI model runtime — the provider slot the AI Model Manager is built against, so the manager
 * never names Ollama. An implementation owns one runtime's native API and maps it into the normalised
 * `@shared/api/model-runtime-types` shapes.
 *
 * It covers the read surface (enumerating installed and running models, inspecting one, removing one)
 * and the server lifecycle (finding or installing the binary, starting and stopping the server).
 * Pulling models is added by #411.
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

  /**
   * Finds the runtime's binary: one the user installed, one Studio manages, or neither.
   * @returns Returns the installation that was found.
   */
  installation(): Promise<RuntimeInstallation>;

  /**
   * Downloads and installs a Studio-managed copy of the runtime. Only offered when
   * {@link installation} reports `absent` — a user who already has the runtime is never made to
   * download a second copy.
   * @param onProgress Receives install progress, which matters because the archives are large.
   * @returns Returns the resulting installation, which is `absent` when the install failed.
   */
  install(onProgress: (progress: RuntimeInstallProgress) => void): Promise<RuntimeInstallation>;

  /**
   * Starts the runtime's server, waiting until it answers. A server that is already running is
   * reported as started.
   * @returns Returns true once the server answers.
   */
  start(): Promise<boolean>;

  /**
   * Stops the runtime's server. Only a server Studio started is stopped; one the user is running
   * themselves is left alone and this resolves false.
   * @returns Returns true when a Studio-owned server was stopped.
   */
  stop(): Promise<boolean>;

  /**
   * Reports how much disk the runtime's model store is using.
   * @returns Returns the disk usage.
   */
  diskUsage(): Promise<ModelDiskUsage>;

  /**
   * Releases anything the runtime holds open, for application teardown. Optional.
   */
  dispose?(): void;
}
