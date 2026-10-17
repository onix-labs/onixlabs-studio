// The container-engine plugin's entry point: serves the container-engine protocol over standard
// streams (#973). Built twice from this source — once as the Docker plugin, once as the Podman one —
// because both engines serve the Docker Engine API; each manifest says where its engine's socket is.
//
// Studio spawns this once and keeps it running. Each line on stdin is one request; each answer goes
// back as one line on stdout carrying the request's `id`. While Studio is watching, engine events go
// out as event lines in between.
import { createInterface, Interface } from 'node:readline';
import { DockerEngine } from './engine';
import { note } from './log';
import {
  CONTAINER_ENGINE_PROTOCOL_VERSION,
  ContainerEngineCapability,
  ContainerEngineEventLine,
  ContainerEnginePullLine,
  ContainerEngineResponse,
  ContainerEvent,
  ImagePullProgress,
  RunContainerRequest,
} from './protocol';
import { StreamHandle } from './transport';

/**
 * What this plugin can do.
 */
const CAPABILITIES: readonly ContainerEngineCapability[] = [
  'containers',
  'images',
  'lifecycle',
  'logs',
  'events',
  'stats',
  'volumes',
  'pause',
  'restart',
  'imageRemove',
  'imagePull',
  'run',
];

/**
 * The engine client, made at `initialize` once Studio has said where the socket is.
 */
let engine: DockerEngine | null = null;

/**
 * The event stream while Studio is watching, else null.
 */
let watching: StreamHandle | null = null;

/**
 * Writes one line to stdout.
 * @param message The message.
 */
function write(
  message: ContainerEngineResponse | ContainerEngineEventLine | ContainerEnginePullLine,
): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Reads a string parameter.
 * @param params The request's parameters.
 * @param key The parameter.
 * @returns Returns the string, or empty.
 */
function text(params: unknown, key: string): string {
  const value: unknown =
    typeof params === 'object' && params !== null
      ? (params as Record<string, unknown>)[key]
      : undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * Answers one operation.
 * @param op The operation.
 * @param params Its parameters.
 * @returns Returns the result.
 */
async function answer(op: string, params: unknown): Promise<unknown> {
  if (op === 'initialize') {
    const socketPath: string = text(params, 'socketPath');
    if (socketPath.length === 0) {
      throw new Error('No socket was given.');
    }
    watching?.close();
    watching = null;
    engine = new DockerEngine(socketPath);
    return { protocol: CONTAINER_ENGINE_PROTOCOL_VERSION, capabilities: CAPABILITIES };
  }
  if (engine === null) {
    throw new Error('The plugin has not been initialised.');
  }
  switch (op) {
    case 'status':
      return engine.status();
    case 'listContainers':
      return engine.listContainers();
    case 'listImages':
      return engine.listImages();
    case 'start':
      return engine.start(text(params, 'id'));
    case 'stop':
      return engine.stop(text(params, 'id'));
    case 'remove':
      return engine.remove(text(params, 'id'));
    case 'logs': {
      const tail: unknown =
        typeof params === 'object' && params !== null
          ? (params as Record<string, unknown>)['tail']
          : undefined;
      return engine.logs(text(params, 'id'), typeof tail === 'number' ? tail : 500);
    }
    case 'stats': {
      const ids: unknown =
        typeof params === 'object' && params !== null
          ? (params as Record<string, unknown>)['ids']
          : undefined;
      return engine.stats(
        Array.isArray(ids) ? ids.filter((id: unknown): id is string => typeof id === 'string') : [],
      );
    }
    case 'listVolumes':
      return engine.listVolumes();
    case 'removeVolume':
      return engine.removeVolume(text(params, 'name'));
    case 'pause':
      return engine.pause(text(params, 'id'));
    case 'unpause':
      return engine.unpause(text(params, 'id'));
    case 'restart':
      return engine.restart(text(params, 'id'));
    case 'removeImage':
      return engine.removeImage(
        text(params, 'id'),
        typeof params === 'object' &&
          params !== null &&
          (params as Record<string, unknown>)['force'] === true,
      );
    case 'pullImage':
      return engine.pullImage(text(params, 'reference'), (progress: ImagePullProgress): void =>
        write({ type: 'pull', progress }),
      );
    case 'run': {
      const request: unknown =
        typeof params === 'object' && params !== null
          ? (params as Record<string, unknown>)['request']
          : undefined;
      if (typeof request !== 'object' || request === null) {
        throw new Error('Say what to run.');
      }
      return engine.run(request as RunContainerRequest);
    }
    case 'watchStart':
      watching ??= engine.watch((event: ContainerEvent): void => write({ type: 'event', event }));
      return true;
    case 'watchStop':
      watching?.close();
      watching = null;
      return true;
    default:
      throw new Error(`Unknown operation '${op}'.`);
  }
}

/**
 * Answers one request line.
 * @param line The line.
 */
async function handle(line: string): Promise<void> {
  let request: unknown;
  try {
    request = JSON.parse(line);
  } catch {
    note('engine', 'Ignored a line that is not JSON');
    return;
  }
  const record: Record<string, unknown> =
    typeof request === 'object' && request !== null ? (request as Record<string, unknown>) : {};
  const id: unknown = record['id'];
  const op: unknown = record['op'];
  if (typeof id !== 'number' || typeof op !== 'string') {
    note('engine', 'Ignored a request with no id or operation');
    return;
  }
  try {
    write({ id, ok: true, result: (await answer(op, record['params'])) as never });
  } catch (error: unknown) {
    write({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const lines: Interface = createInterface({ input: process.stdin });
lines.on('line', (line: string): void => {
  if (line.trim().length > 0) {
    void handle(line);
  }
});
// Studio closing stdin is how it says the session is over.
lines.on('close', (): void => {
  watching?.close();
  process.exit(0);
});
