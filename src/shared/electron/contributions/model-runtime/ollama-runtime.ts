import { Dirent, Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  LocalModel,
  ModelDetails,
  ModelDiskUsage,
  ModelRuntimeStatus,
  RunningModel,
  RuntimeInstallation,
  RuntimeInstallProgress,
} from '@shared/api/model-runtime-types';
import { ModelRuntime } from './model-runtime';
import { OllamaProvisioner } from './ollama-provisioner';
import { OllamaServer } from './ollama-server';
import { HttpOllamaTransport, OllamaResponse, OllamaTransport } from './ollama-transport';

/**
 * The `details` block Ollama attaches to a model in several of its responses.
 */
interface RawModelDetails {
  readonly format?: string;
  readonly family?: string;
  readonly parameter_size?: string;
  readonly quantization_level?: string;
}

/**
 * The raw model shape from `GET /api/tags`.
 */
interface RawTagsModel {
  readonly name?: string;
  readonly model?: string;
  readonly size?: number;
  readonly digest?: string;
  readonly modified_at?: string;
  readonly details?: RawModelDetails;
}

/**
 * The raw model shape from `GET /api/ps`.
 */
interface RawPsModel {
  readonly name?: string;
  readonly model?: string;
  readonly size?: number;
  readonly size_vram?: number;
  readonly expires_at?: string;
}

/**
 * The raw shape from `POST /api/show`. `model_info` is a flat bag of architecture-prefixed GGUF
 * metadata keys, which is why the context length is looked up by suffix rather than by name.
 */
interface RawShow {
  readonly details?: RawModelDetails;
  readonly capabilities?: readonly string[];
  readonly model_info?: Readonly<Record<string, unknown>>;
}

/**
 * Ollama's default server origin, used when the environment names none.
 */
const DEFAULT_ORIGIN: string = 'http://127.0.0.1:11434';

/**
 * The first {@link ModelRuntime} implementation: a thin client for Ollama's native REST API
 * (`/api/tags`, `/api/ps`, `/api/show`, `/api/delete`, `/api/version`).
 *
 * Every operation is server-absent-safe, as the slot requires: a connection failure resolves to an
 * empty result, a null, or an unavailable status rather than throwing to the renderer, so the manager
 * view renders "not running" as an ordinary state.
 */
export class OllamaRuntime implements ModelRuntime {
  /**
   * The stable runtime identifier.
   */
  public readonly id: string = 'ollama';

  /**
   * The human-readable runtime name.
   */
  public readonly displayName: string = 'Ollama';

  /**
   * The transport the native API is spoken over.
   */
  private readonly transport: OllamaTransport;

  /**
   * Finds or installs the runtime binary, or null when this runtime was built without one (the unit
   * tests, which exercise the API surface against a fake transport).
   */
  private readonly provisioner: OllamaProvisioner | null;

  /**
   * Starts and stops the server, or null when this runtime was built without a provisioner.
   */
  private readonly server: OllamaServer | null;

  /**
   * Initializes a new instance of the {@link OllamaRuntime} class.
   * @param origin The server origin; defaults to Ollama's standard local address.
   * @param transport The transport to use; defaults to JSON over HTTP to the origin.
   * @param provisioner Finds and installs the binary; omitted in tests that only exercise the API.
   */
  public constructor(
    origin: string = DEFAULT_ORIGIN,
    transport?: OllamaTransport,
    provisioner?: OllamaProvisioner,
  ) {
    this.transport = transport ?? new HttpOllamaTransport(origin);
    this.provisioner = provisioner ?? null;
    this.server =
      provisioner === undefined
        ? null
        : new OllamaServer(hostFromOrigin(origin), async (): Promise<boolean> => {
            return (await this.status()).available;
          });
  }

  /**
   * Reports whether the Ollama server is reachable, its version when it is, and whether it is the
   * server Studio started.
   * @returns Returns the runtime status.
   */
  public async status(): Promise<ModelRuntimeStatus> {
    const raw: { version?: string } | null = await this.json<{ version?: string }>(
      'GET',
      '/api/version',
    );
    if (raw === null) {
      return { available: false };
    }
    return {
      available: true,
      version: raw.version,
      startedByStudio: this.server?.isOwned() ?? false,
    };
  }

  /**
   * Finds the Ollama binary: one the user installed, one Studio manages, or neither.
   * @returns Returns the installation that was found.
   */
  public installation(): Promise<RuntimeInstallation> {
    return (
      this.provisioner?.detect() ??
      Promise.resolve({ kind: 'absent' as const, executable: '', version: '' })
    );
  }

  /**
   * Downloads and installs a Studio-managed copy of Ollama.
   * @param onProgress Receives install progress.
   * @returns Returns the resulting installation.
   */
  public install(
    onProgress: (progress: RuntimeInstallProgress) => void,
  ): Promise<RuntimeInstallation> {
    return (
      this.provisioner?.install(onProgress) ??
      Promise.resolve({ kind: 'absent' as const, executable: '', version: '' })
    );
  }

  /**
   * Starts the Ollama server, installing nothing: when no binary is present the caller is expected to
   * offer {@link install} first, so a click on "start" never silently downloads a gigabyte.
   * @returns Returns true once the server answers.
   */
  public async start(): Promise<boolean> {
    if (this.server === null) {
      return false;
    }
    const installation: RuntimeInstallation = await this.installation();
    if (installation.kind === 'absent') {
      return false;
    }
    return this.server.start(installation.executable);
  }

  /**
   * Stops the Ollama server, when it is the one Studio started.
   * @returns Returns true when a Studio-owned server was stopped.
   */
  public stop(): Promise<boolean> {
    return this.server?.stop() ?? Promise.resolve(false);
  }

  /**
   * Reports how much disk Ollama's model store is using, by summing the blob files its weights are
   * stored as.
   * @returns Returns the disk usage.
   */
  public async diskUsage(): Promise<ModelDiskUsage> {
    const store: string = ollamaModelStore(process.env, os.homedir());
    try {
      const blobs: string = path.join(store, 'blobs');
      const entries: Dirent[] = await fs.readdir(blobs, { withFileTypes: true });
      let bytes: number = 0;
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const stat: Stats = await fs.stat(path.join(blobs, entry.name));
        bytes += stat.size;
      }
      return { bytes, path: store };
    } catch {
      return { bytes: 0, path: '' };
    }
  }

  /**
   * Stops a Studio-owned server, for application teardown.
   */
  public dispose(): void {
    this.server?.dispose();
  }

  /**
   * Lists the models installed locally. Returns an empty list when the server is unreachable.
   * @returns Returns the installed models.
   */
  public async list(): Promise<LocalModel[]> {
    const raw: { models?: readonly RawTagsModel[] } | null = await this.json<{
      models?: readonly RawTagsModel[];
    }>('GET', '/api/tags');

    return (raw?.models ?? []).map(
      (model: RawTagsModel): LocalModel => ({
        name: model.name ?? model.model ?? '',
        size: model.size ?? 0,
        digest: model.digest ?? '',
        modifiedAt: model.modified_at ?? '',
        family: model.details?.family ?? '',
        parameterSize: model.details?.parameter_size ?? '',
        quantization: model.details?.quantization_level ?? '',
      }),
    );
  }

  /**
   * Lists the models currently loaded into memory. Returns an empty list when the server is
   * unreachable.
   * @returns Returns the running models.
   */
  public async running(): Promise<RunningModel[]> {
    const raw: { models?: readonly RawPsModel[] } | null = await this.json<{
      models?: readonly RawPsModel[];
    }>('GET', '/api/ps');

    return (raw?.models ?? []).map(
      (model: RawPsModel): RunningModel => ({
        name: model.name ?? model.model ?? '',
        size: model.size ?? 0,
        sizeVram: model.size_vram ?? 0,
        expiresAt: model.expires_at ?? '',
      }),
    );
  }

  /**
   * Reads one model's detailed metadata.
   * @param name The fully-qualified model reference.
   * @returns Returns the details, or null when the model is not installed or the server is unreachable.
   */
  public async show(name: string): Promise<ModelDetails | null> {
    const raw: RawShow | null = await this.json<RawShow>('POST', '/api/show', modelBody(name));
    if (raw === null) {
      return null;
    }
    return {
      name,
      family: raw.details?.family ?? '',
      parameterSize: raw.details?.parameter_size ?? '',
      quantization: raw.details?.quantization_level ?? '',
      format: raw.details?.format ?? '',
      contextLength: readContextLength(raw.model_info),
      capabilities: raw.capabilities ?? [],
    };
  }

  /**
   * Removes an installed model, deleting its weights.
   * @param name The fully-qualified model reference.
   * @returns Returns true when the server accepted the request.
   */
  public async remove(name: string): Promise<boolean> {
    try {
      const response: OllamaResponse = await this.transport.request(
        'DELETE',
        '/api/delete',
        modelBody(name),
      );
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch {
      return false;
    }
  }

  /**
   * Performs a request and parses its JSON body, or resolves null when the server is unreachable,
   * answers with a non-2xx status, or returns a malformed body — so callers can fall back rather than
   * throw.
   * @param method The HTTP method.
   * @param path The request path.
   * @param body The JSON body to send, or undefined for a bodyless request.
   * @returns Returns the parsed body, or null.
   */
  private async json<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    try {
      const response: OllamaResponse = await this.transport.request(method, path, body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return null;
      }
      return JSON.parse(response.body) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Builds the request body naming a model. Ollama renamed this field from `name` to `model`, and still
 * accepts the old one, so both are sent to stay compatible across the versions a user may have
 * installed.
 * @param name The fully-qualified model reference.
 * @returns Returns the request body.
 */
function modelBody(name: string): Record<string, string> {
  return { model: name, name };
}

/**
 * Reduces a server origin to the `host[:port]` form `OLLAMA_HOST` takes, so a spawned server listens
 * exactly where the client will look for it. Exported for unit testing.
 * @param origin The server origin (for example `http://127.0.0.1:11434`).
 * @returns Returns the host and port.
 */
export function hostFromOrigin(origin: string): string {
  try {
    const url: URL = new URL(origin);
    return url.port.length > 0 ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return origin;
  }
}

/**
 * Resolves where Ollama keeps its model weights: `OLLAMA_MODELS` when set, otherwise `~/.ollama/models`.
 * Exported for unit testing.
 * @param env The environment to read.
 * @param home The user's home directory.
 * @returns Returns the model store directory.
 */
export function ollamaModelStore(env: Record<string, string | undefined>, home: string): string {
  const explicit: string | undefined = env['OLLAMA_MODELS'];
  return explicit !== undefined && explicit.length > 0
    ? explicit
    : path.join(home, '.ollama', 'models');
}

/**
 * Reads the context length out of Ollama's `model_info` bag. The key is architecture-prefixed
 * (`llama.context_length`, `qwen2.context_length`, …), so it is matched by suffix rather than by an
 * exhaustive list of architectures we would have to keep chasing.
 * @param info The `model_info` bag, or undefined when absent.
 * @returns Returns the context length in tokens, or undefined when unreported.
 */
export function readContextLength(
  info: Readonly<Record<string, unknown>> | undefined,
): number | undefined {
  if (info === undefined) {
    return undefined;
  }
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith('.context_length') && typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}
