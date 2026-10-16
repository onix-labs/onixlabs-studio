import {
  CONTROL_CONTAINER,
  LIST_CONTAINER_IMAGES,
  LIST_CONTAINER_VOLUMES,
  LIST_CONTAINERS,
  PULL_IMAGE,
  READ_CONTAINER_LOGS,
  REMOVE_CONTAINER,
  REMOVE_IMAGE,
  REMOVE_VOLUME,
  RUN_CONTAINER,
} from '@shared/api/ai-types';
import type { RunContainerRequest } from '@shared/api/container-types';
import { logger } from '@shared/electron/logger';
import type { AgentRunContext } from './agent-provider';

// The Containers agent's tools (#969). The renderer acts through the same client the view's buttons
// use, so what the agent does is what a click would do, and the list it shows follows at once.

/**
 * How long a download may take before the agent stops waiting: an image can be gigabytes.
 */
const PULL_TIMEOUT_MS: number = 30 * 60_000;

/**
 * How long a run may take: creating a container and starting it.
 */
const RUN_TIMEOUT_MS: number = 2 * 60_000;

/**
 * Appended to the system prompt for a Containers run, so the model knows what it is docked to, what it
 * can reach, and what it is not for.
 */
export const CONTAINERS_PROMPT_APPENDIX: string = [
  'You are running inside ONIXLabs Studio, docked to the Containers view: the containers, images and',
  'volumes of the container engine on this machine (Docker or Podman). You can:',
  `- "${LIST_CONTAINERS}" lists the containers — state, status, image, published ports, mounted`,
  '  volumes, and CPU and memory while they run.',
  `- "${LIST_CONTAINER_IMAGES}" and "${LIST_CONTAINER_VOLUMES}" list the images and the volumes.`,
  `- "${READ_CONTAINER_LOGS}" reads a container's most recent log lines.`,
  `- "${CONTROL_CONTAINER}" starts, stops, restarts, pauses or resumes a container.`,
  `- "${RUN_CONTAINER}" runs a new container from an image, with a name, published ports,`,
  '  environment variables and mounts.',
  `- "${PULL_IMAGE}" downloads an image.`,
  `- "${REMOVE_CONTAINER}", "${REMOVE_IMAGE}" and "${REMOVE_VOLUME}" remove one.`,
  'Running something: list the images first. When the image is not on this machine, pull it, then',
  'run it. Name the container after what it is for, and publish only the ports the user needs. A',
  'database needs its password or settings as environment variables; say which you chose.',
  'Explaining a container that stopped or keeps restarting: read its logs, then say in a sentence or',
  'two what went wrong and what would fix it. Quote only the lines that matter.',
  'Removing: only what the user asked to remove. A volume holds data that cannot be got back, so say',
  'so before removing one. The user is asked before anything is pulled, run or removed.',
  'You are kept to this view. You cannot read or change files, run commands, or act anywhere else in',
  'Studio. When the user asks for something outside it, say which part of Studio can help instead.',
].join('\n');

/**
 * Asks the renderer for something and renders the answer for the model.
 * @param context The agent run context (carries the bridge).
 * @param name The capability.
 * @param input What to send.
 * @param done How to describe a success, given the answer.
 * @param timeoutMs How long to wait for the renderer.
 * @returns Returns the rendered answer.
 */
async function ask(
  context: AgentRunContext,
  name: string,
  input: Record<string, unknown>,
  done: (answer: Record<string, unknown>) => string = (answer: Record<string, unknown>): string =>
    JSON.stringify(answer['result'] ?? {}, null, 2),
  timeoutMs?: number,
): Promise<string> {
  logger.trace('ContainersTools', `Tool invoked: ${name}`);
  const result: unknown = await context.bridge.request(name, input, timeoutMs);
  const answer: Record<string, unknown> =
    result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  if (answer['available'] !== true) {
    return 'The Containers view is not open, so it cannot be reached.';
  }
  if (typeof answer['error'] === 'string') {
    logger.debug('ContainersTools', `${name} refused: ${answer['error']}`);
    return answer['error'];
  }
  return done(answer);
}

/**
 * Lists the containers.
 * @param context The agent run context.
 * @param runningOnly Whether to list only running containers.
 * @returns Returns the containers.
 */
export function listContainers(
  context: AgentRunContext,
  runningOnly: boolean | undefined,
): Promise<string> {
  return ask(context, LIST_CONTAINERS, { runningOnly: runningOnly === true });
}

/**
 * Lists the images.
 * @param context The agent run context.
 * @returns Returns the images.
 */
export function listContainerImages(context: AgentRunContext): Promise<string> {
  return ask(context, LIST_CONTAINER_IMAGES, {});
}

/**
 * Lists the volumes.
 * @param context The agent run context.
 * @returns Returns the volumes.
 */
export function listContainerVolumes(context: AgentRunContext): Promise<string> {
  return ask(context, LIST_CONTAINER_VOLUMES, {});
}

/**
 * Reads a container's most recent log lines.
 * @param context The agent run context.
 * @param id The container's id or name.
 * @param tail How many lines, at most.
 * @returns Returns the lines.
 */
export function readContainerLogs(
  context: AgentRunContext,
  id: string,
  tail: number | undefined,
): Promise<string> {
  return ask(
    context,
    READ_CONTAINER_LOGS,
    { id, tail: tail ?? 200 },
    (answer: Record<string, unknown>): string => {
      const lines: readonly string[] = Array.isArray(answer['lines'])
        ? (answer['lines'] as readonly string[])
        : [];
      if (lines.length === 0) {
        return `${id} has written nothing to its log.`;
      }
      return `${answer['truncated'] === true ? '(older lines left out)\n' : ''}${lines.join('\n')}`;
    },
  );
}

/**
 * Starts, stops, restarts, pauses or resumes a container.
 * @param context The agent run context.
 * @param id The container's id or name.
 * @param action What to do.
 * @returns Returns what happened.
 */
export function controlContainer(
  context: AgentRunContext,
  id: string,
  action: string,
): Promise<string> {
  return ask(
    context,
    CONTROL_CONTAINER,
    { id, action },
    (answer: Record<string, unknown>): string =>
      `${typeof answer['name'] === 'string' ? answer['name'] : id} is now ${typeof answer['state'] === 'string' ? answer['state'] : 'changed'}.`,
  );
}

/**
 * Removes a container.
 * @param context The agent run context.
 * @param id The container's id or name.
 * @returns Returns what happened.
 */
export function removeContainer(context: AgentRunContext, id: string): Promise<string> {
  return ask(context, REMOVE_CONTAINER, { id }, (): string => `Removed ${id}.`);
}

/**
 * Downloads an image, waiting until it has arrived.
 * @param context The agent run context.
 * @param reference The image reference, as in postgres:16.
 * @returns Returns what happened.
 */
export function pullImage(context: AgentRunContext, reference: string): Promise<string> {
  return ask(
    context,
    PULL_IMAGE,
    { reference },
    (): string => `Pulled ${reference}.`,
    PULL_TIMEOUT_MS,
  );
}

/**
 * Removes an image.
 * @param context The agent run context.
 * @param id The image's tag or id.
 * @returns Returns what happened.
 */
export function removeImage(context: AgentRunContext, id: string): Promise<string> {
  return ask(context, REMOVE_IMAGE, { id }, (): string => `Removed ${id}.`);
}

/**
 * Removes a volume.
 * @param context The agent run context.
 * @param name The volume's name.
 * @returns Returns what happened.
 */
export function removeVolume(context: AgentRunContext, name: string): Promise<string> {
  return ask(context, REMOVE_VOLUME, { name }, (): string => `Removed the volume ${name}.`);
}

/**
 * Runs a new container.
 * @param context The agent run context.
 * @param request What to run.
 * @returns Returns the new container, or why it did not run.
 */
export function runContainer(
  context: AgentRunContext,
  request: RunContainerRequest,
): Promise<string> {
  return ask(
    context,
    RUN_CONTAINER,
    { ...request },
    (answer: Record<string, unknown>): string =>
      `Started ${request.name ?? 'a container'} from ${request.image} (id ${typeof answer['id'] === 'string' ? answer['id'].slice(0, 12) : 'unknown'}).`,
    RUN_TIMEOUT_MS,
  );
}
