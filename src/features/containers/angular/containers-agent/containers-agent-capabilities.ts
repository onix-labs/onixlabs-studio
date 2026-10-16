import { DestroyRef, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import {
  type AiBridgeScope,
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
import type {
  ContainerPort,
  ContainerStats,
  ContainerSummary,
  ImageSummary,
  RunContainerRequest,
  VolumeSummary,
} from '@shared/api/container-types';
import type { ContainerLogs } from '@shared/api/container-engine-protocol';
import { readRunRequest } from '@shared/api/container-run-request';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { ContainersClient } from '../client/containers-client';

/**
 * An answer to the agent: the run is not the Containers view's, a refusal, or a result.
 */
type Answer =
  | { readonly available: false }
  | { readonly available: true; readonly error: string }
  | ({ readonly available: true } & Record<string, unknown>);

/**
 * What {@link CONTROL_CONTAINER} can do to a container.
 */
type ControlAction = 'start' | 'stop' | 'restart' | 'pause' | 'resume';

/**
 * The Containers agent's capabilities (#969): the containers, images and volumes, a container's logs,
 * and acting on them through the same {@link ContainersClient} the view's buttons use.
 *
 * Provided by the Containers view, so they exist only while it is open, and each answers only a run on
 * the `containers` surface. The permission prompt is main's: by the time a removal reaches here the user
 * has agreed to it.
 */
@Service()
export class ContainersAgentCapabilities {
  /**
   * Holds the engine client.
   */
  private readonly client: ContainersClient = inject(ContainersClient);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Counts the changes the agent has made, so the view reloads after each — an image pulled or a
   * volume removed raises no container event to reload on.
   */
  private readonly changeCount: WritableSignal<number> = signal<number>(0);

  /**
   * Gets how many changes the agent has made.
   */
  public readonly changes: Signal<number> = this.changeCount.asReadonly();

  /**
   * Registers the capabilities, and releases them with the view.
   */
  public constructor() {
    const runtime: AiRuntime = inject(AiRuntime);
    const handlers: Readonly<Record<string, (input: Record<string, unknown>) => Promise<Answer>>> =
      {
        [LIST_CONTAINERS]: (input: Record<string, unknown>): Promise<Answer> =>
          this.listContainers(input['runningOnly'] === true),
        [LIST_CONTAINER_IMAGES]: (): Promise<Answer> => this.listImages(),
        [LIST_CONTAINER_VOLUMES]: (): Promise<Answer> => this.listVolumes(),
        [READ_CONTAINER_LOGS]: (input: Record<string, unknown>): Promise<Answer> =>
          this.readLogs(text(input['id']), input['tail']),
        [CONTROL_CONTAINER]: (input: Record<string, unknown>): Promise<Answer> =>
          this.control(text(input['id']), text(input['action'])),
        [REMOVE_CONTAINER]: (input: Record<string, unknown>): Promise<Answer> =>
          this.removeContainer(text(input['id'])),
        [PULL_IMAGE]: (input: Record<string, unknown>): Promise<Answer> =>
          this.pull(text(input['reference'])),
        [REMOVE_IMAGE]: (input: Record<string, unknown>): Promise<Answer> =>
          this.removeImage(text(input['id'])),
        [REMOVE_VOLUME]: (input: Record<string, unknown>): Promise<Answer> =>
          this.removeVolume(text(input['name'])),
        [RUN_CONTAINER]: (input: Record<string, unknown>): Promise<Answer> => this.run(input),
      };
    const releases: readonly (() => void)[] = Object.entries(handlers).map(
      ([name, handler]: [
        string,
        (input: Record<string, unknown>) => Promise<Answer>,
      ]): (() => void) =>
        runtime.registerCapability(
          name,
          (input: unknown, scope: AiBridgeScope): Answer | Promise<Answer> =>
            scope.surface === 'containers'
              ? handler(
                  input !== null && typeof input === 'object'
                    ? (input as Record<string, unknown>)
                    : {},
                )
              : { available: false },
        ),
    );
    inject(DestroyRef).onDestroy((): void => {
      for (const release of releases) {
        release();
      }
    });
  }

  /**
   * Lists the containers, with CPU and memory for those that run.
   * @param runningOnly Whether to list only running containers.
   * @returns Returns the containers.
   */
  private async listContainers(runningOnly: boolean): Promise<Answer> {
    const refusal: Answer | null = await this.engineRefusal();
    if (refusal !== null) {
      return refusal;
    }
    const containers: readonly ContainerSummary[] = (await this.client.listContainers()).filter(
      (container: ContainerSummary): boolean => !runningOnly || container.state === 'running',
    );
    const stats: readonly ContainerStats[] = await this.client.stats(
      containers
        .filter((container: ContainerSummary): boolean => container.state === 'running')
        .map((container: ContainerSummary): string => container.id),
    );
    const byId: ReadonlyMap<string, ContainerStats> = new Map<string, ContainerStats>(
      stats.map((sample: ContainerStats): [string, ContainerStats] => [sample.id, sample]),
    );
    return {
      available: true,
      result:
        containers.length === 0
          ? { note: runningOnly ? 'No containers are running.' : 'There are no containers.' }
          : containers.map((container: ContainerSummary) => {
              const sample: ContainerStats | undefined = byId.get(container.id);
              return {
                id: container.id.slice(0, 12),
                name: container.names[0] ?? null,
                image: container.image,
                state: container.state,
                status: container.status,
                ports: (container.ports ?? [])
                  .filter((port: ContainerPort): boolean => port.publicPort !== undefined)
                  .map(
                    (port: ContainerPort): string =>
                      `${port.publicPort}->${port.privatePort}/${port.protocol}`,
                  ),
                volumes: container.volumes ?? [],
                ...(sample === undefined
                  ? {}
                  : {
                      cpuPercent: Math.round(sample.cpuPercent * 10) / 10,
                      memoryMb: Math.round(sample.memoryBytes / 1024 / 1024),
                    }),
              };
            }),
    };
  }

  /**
   * Lists the images, with the containers using each.
   * @returns Returns the images.
   */
  private async listImages(): Promise<Answer> {
    const refusal: Answer | null = await this.engineRefusal();
    if (refusal !== null) {
      return refusal;
    }
    const [images, containers]: [ImageSummary[], ContainerSummary[]] = await Promise.all([
      this.client.listImages(),
      this.client.listContainers(),
    ]);
    return {
      available: true,
      result:
        images.length === 0
          ? { note: 'There are no images on this machine.' }
          : images.map((image: ImageSummary) => ({
              id: image.id.replace(/^sha256:/, '').slice(0, 12),
              tags: image.tags,
              sizeMb: Math.round(image.size / 1024 / 1024),
              usedBy: containers
                .filter((container: ContainerSummary): boolean =>
                  imageMatches(image, container.image),
                )
                .map((container: ContainerSummary): string => nameOf(container)),
            })),
    };
  }

  /**
   * Lists the volumes, with the containers mounting each.
   * @returns Returns the volumes.
   */
  private async listVolumes(): Promise<Answer> {
    const refusal: Answer | null = await this.engineRefusal();
    if (refusal !== null) {
      return refusal;
    }
    const [volumes, containers]: [VolumeSummary[], ContainerSummary[]] = await Promise.all([
      this.client.listVolumes(),
      this.client.listContainers(),
    ]);
    return {
      available: true,
      result:
        volumes.length === 0
          ? { note: 'There are no volumes.' }
          : volumes.map((volume: VolumeSummary) => ({
              name: volume.name,
              driver: volume.driver,
              anonymous: volume.anonymous,
              mountedBy: containers
                .filter(
                  (container: ContainerSummary): boolean =>
                    container.volumes?.includes(volume.name) === true,
                )
                .map((container: ContainerSummary): string => nameOf(container)),
            })),
    };
  }

  /**
   * Reads a container's most recent log lines.
   * @param reference The container's name or id.
   * @param tail How many lines, at most.
   * @returns Returns the lines.
   */
  private async readLogs(reference: string, tail: unknown): Promise<Answer> {
    const found: ContainerSummary | Answer = await this.findContainer(reference);
    if (!isContainer(found)) {
      return found;
    }
    const lines: number =
      typeof tail === 'number' && Number.isInteger(tail) ? Math.min(Math.max(tail, 1), 2000) : 200;
    const logs: ContainerLogs = await this.client.logs(found.id, lines);
    return { available: true, lines: logs.lines, truncated: logs.truncated };
  }

  /**
   * Starts, stops, restarts, pauses or resumes a container.
   * @param reference The container's name or id.
   * @param action What to do.
   * @returns Returns the container's state afterwards.
   */
  private async control(reference: string, action: string): Promise<Answer> {
    const found: ContainerSummary | Answer = await this.findContainer(reference);
    if (!isContainer(found)) {
      return found;
    }
    const act: Readonly<Record<ControlAction, (id: string) => Promise<boolean>>> = {
      start: (id: string): Promise<boolean> => this.client.start(id),
      stop: (id: string): Promise<boolean> => this.client.stop(id),
      restart: (id: string): Promise<boolean> => this.client.restart(id),
      pause: (id: string): Promise<boolean> => this.client.pause(id),
      resume: (id: string): Promise<boolean> => this.client.unpause(id),
    };
    if (!(action in act)) {
      return { available: true, error: `"${action}" is not something a container can do.` };
    }
    const name: string = nameOf(found);
    if (!(await act[action as ControlAction](found.id))) {
      return { available: true, error: `${name} did not ${action}; it is ${found.state}.` };
    }
    this.changed(`${action} '${name}'`);
    const after: ContainerSummary | undefined = (await this.client.listContainers()).find(
      (container: ContainerSummary): boolean => container.id === found.id,
    );
    return { available: true, name, state: after?.state ?? 'changed' };
  }

  /**
   * Removes a container, stopping it first when it runs: the engine will not remove a running one.
   * @param reference The container's name or id.
   * @returns Returns whether it was removed.
   */
  private async removeContainer(reference: string): Promise<Answer> {
    const found: ContainerSummary | Answer = await this.findContainer(reference);
    if (!isContainer(found)) {
      return found;
    }
    if (found.state === 'running' || found.state === 'paused') {
      if (found.state === 'paused') {
        await this.client.unpause(found.id);
      }
      await this.client.stop(found.id);
    }
    if (!(await this.client.remove(found.id))) {
      return { available: true, error: `${nameOf(found)} could not be removed.` };
    }
    this.changed(`removed '${nameOf(found)}'`);
    return { available: true, removed: true };
  }

  /**
   * Downloads an image.
   * @param reference The image reference.
   * @returns Returns whether it arrived.
   */
  private async pull(reference: string): Promise<Answer> {
    if (reference.length === 0) {
      return { available: true, error: 'Name the image to pull, as in postgres:16.' };
    }
    const refusal: Answer | null = await this.engineRefusal();
    if (refusal !== null) {
      return refusal;
    }
    const outcome: { ok: boolean; error?: string } = await this.client.pullImage(reference);
    if (!outcome.ok) {
      return {
        available: true,
        error: `${reference} could not be pulled: ${outcome.error ?? 'the engine did not say why'}.`,
      };
    }
    this.changed(`pulled '${reference}'`);
    return { available: true, pulled: true };
  }

  /**
   * Removes an image. The engine refuses one a container uses; that is said, not forced.
   * @param reference The image's tag or id.
   * @returns Returns whether it was removed.
   */
  private async removeImage(reference: string): Promise<Answer> {
    const images: readonly ImageSummary[] = await this.client.listImages();
    const image: ImageSummary | undefined = images.find((candidate: ImageSummary): boolean =>
      imageMatches(candidate, reference),
    );
    if (image === undefined) {
      return { available: true, error: `There is no image "${reference}" on this machine.` };
    }
    const users: readonly ContainerSummary[] = (await this.client.listContainers()).filter(
      (container: ContainerSummary): boolean => imageMatches(image, container.image),
    );
    if (users.length > 0) {
      return {
        available: true,
        error: `${reference} is used by ${users.map(nameOf).join(', ')}; remove those containers first.`,
      };
    }
    if (!(await this.client.removeImage(image.id))) {
      return { available: true, error: `${reference} could not be removed.` };
    }
    this.changed(`removed image '${reference}'`);
    return { available: true, removed: true };
  }

  /**
   * Removes a volume. Refused while a container mounts it.
   * @param name The volume's name.
   * @returns Returns whether it was removed.
   */
  private async removeVolume(name: string): Promise<Answer> {
    const volumes: readonly VolumeSummary[] = await this.client.listVolumes();
    if (!volumes.some((volume: VolumeSummary): boolean => volume.name === name)) {
      return { available: true, error: `There is no volume "${name}".` };
    }
    const users: readonly ContainerSummary[] = (await this.client.listContainers()).filter(
      (container: ContainerSummary): boolean => container.volumes?.includes(name) === true,
    );
    if (users.length > 0) {
      return {
        available: true,
        error: `${name} is mounted by ${users.map(nameOf).join(', ')}; remove those containers first.`,
      };
    }
    if (!(await this.client.removeVolume(name))) {
      return { available: true, error: `The volume ${name} could not be removed.` };
    }
    this.changed(`removed volume '${name}'`);
    return { available: true, removed: true };
  }

  /**
   * Runs a new container.
   * @param input The request, as the model sent it.
   * @returns Returns the new container's id, or why it did not run.
   */
  private async run(input: Record<string, unknown>): Promise<Answer> {
    const request: RunContainerRequest | null = readRunRequest(input);
    if (request === null) {
      return { available: true, error: 'That is not a container to run: name an image at least.' };
    }
    const outcome: { id?: string; error?: string } = await this.client.run(request);
    if (outcome.error !== undefined || outcome.id === undefined) {
      return { available: true, error: outcome.error ?? 'The engine did not start it.' };
    }
    this.changed(`ran '${request.image}'`);
    return { available: true, id: outcome.id };
  }

  /**
   * Finds a container by its name or id — the whole id or the first characters of it.
   * @param reference The name or id.
   * @returns Returns the container, or a refusal saying there is none.
   */
  private async findContainer(reference: string): Promise<ContainerSummary | Answer> {
    const refusal: Answer | null = await this.engineRefusal();
    if (refusal !== null) {
      return refusal;
    }
    const wanted: string = reference.replace(/^\//, '');
    const containers: readonly ContainerSummary[] = await this.client.listContainers();
    const found: ContainerSummary | undefined =
      containers.find((container: ContainerSummary): boolean => container.names.includes(wanted)) ??
      (wanted.length >= 4
        ? containers.find((container: ContainerSummary): boolean => container.id.startsWith(wanted))
        : undefined);
    return (
      found ?? {
        available: true,
        error: `There is no container "${reference}". List the containers to see their names.`,
      }
    );
  }

  /**
   * Says why the engine cannot be asked, when it cannot.
   * @returns Returns the refusal, or null when the engine answers.
   */
  private async engineRefusal(): Promise<Answer | null> {
    await this.client.ready();
    if ((await this.client.status()).available) {
      return null;
    }
    const engine: string | undefined = this.client.engineInEffect()?.displayName;
    return {
      available: true,
      error:
        engine === undefined
          ? 'No container engine is installed. The Plugin Manager offers Docker and Podman.'
          : `${engine} is not running. Start it, then ask again.`,
    };
  }

  /**
   * Records a change the agent made, so the view reloads.
   * @param what What changed, for the log.
   */
  private changed(what: string): void {
    this.log.info('containers.agent', `Agent ${what}`);
    this.changeCount.update((count: number): number => count + 1);
  }
}

/**
 * Reads a string out of a request field.
 * @param value The field.
 * @returns Returns the trimmed string, or empty.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Gets whether a lookup found a container rather than a refusal.
 * @param value The lookup's result.
 * @returns Returns true for a container.
 */
function isContainer(value: ContainerSummary | Answer): value is ContainerSummary {
  return 'names' in value;
}

/**
 * Names a container for a sentence: its first name, or a short id.
 * @param container The container.
 * @returns Returns the name.
 */
function nameOf(container: ContainerSummary): string {
  return container.names[0] ?? container.id.slice(0, 12);
}

/**
 * Gets whether an image reference — a tag, a bare repository, or an id — names an image.
 * @param image The image.
 * @param reference The reference.
 * @returns Returns true when it does.
 */
function imageMatches(image: ImageSummary, reference: string): boolean {
  const id: string = image.id.replace(/^sha256:/, '');
  const wanted: string = reference.replace(/^sha256:/, '');
  return (
    image.tags.includes(reference) ||
    image.tags.includes(`${reference}:latest`) ||
    (wanted.length >= 4 && id.startsWith(wanted))
  );
}
