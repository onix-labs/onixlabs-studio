import { effect, inject, Service, signal, Signal, untracked, WritableSignal } from '@angular/core';
import { Forge } from '@shared/angular/services/forge/forge';
import {
  ForgeProject,
  ForgeProjects,
} from '@shared/angular/services/forge-projects/forge-projects';
import { Log } from '@shared/angular/services/log/log';
import { ForgeResult, ForgeWorkItem } from '@shared/api/forge-types';
import { buildWorkItemTree, WorkItemNode } from './work-item-tree';

/**
 * How often a watched project's hierarchy is re-read. The forge's entity-tag cache makes an unchanged
 * page free, so this is about how stale the view may be, not about budget.
 */
export const WORK_ITEMS_REFRESH_MS: number = 120_000;

/**
 * Describes where one project's hierarchy has got to.
 */
export interface ProjectWorkItems {
  /**
   * Gets the project's work-item tree: the last one read, kept while a refresh runs or after one fails,
   * so the view never empties for a transient reason.
   */
  readonly tree: readonly WorkItemNode[];

  /**
   * Gets a value indicating whether a tree has been read at all.
   */
  readonly loaded: boolean;

  /**
   * Gets a value indicating whether a read is in flight.
   */
  readonly loading: boolean;

  /**
   * Gets why the last read failed, or null when it succeeded.
   */
  readonly error: string | null;

  /**
   * Gets a value indicating whether the last failure was the forge refusing the credential, which the
   * view answers with "sign in" rather than "try again".
   */
  readonly unauthorized: boolean;
}

/**
 * The state of a project nothing has been read for yet.
 */
const UNREAD: ProjectWorkItems = {
  tree: [],
  loaded: false,
  loading: false,
  error: null,
  unauthorized: false,
};

/**
 * Reads and holds the work-item hierarchy of every open project, for Mission Control's Hierarchy face
 * (epic #788).
 *
 * Reads happen only while something is watching, the way the Repository panel's forge sections poll
 * only for the tab in front: Mission Control stays mounted while hidden, so being alive says nothing
 * about anyone looking. A rate-limited project is left alone until the forge says it may be asked
 * again.
 */
@Service()
export class MissionControlWorkItems {
  /**
   * Holds the forge client.
   */
  private readonly forge: Forge = inject(Forge);

  /**
   * Holds the registry of open projects.
   */
  private readonly forgeProjects: ForgeProjects = inject(ForgeProjects);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds each project's state, keyed by project.
   */
  private readonly stateMap: WritableSignal<ReadonlyMap<string, ProjectWorkItems>> = signal<
    ReadonlyMap<string, ProjectWorkItems>
  >(new Map<string, ProjectWorkItems>());

  /**
   * Holds a value indicating whether anything is watching.
   */
  private readonly watching: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the refresh timer while watching.
   */
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Holds, per project, when the forge will next accept a request after refusing one for the rate
   * limit, as epoch milliseconds.
   */
  private readonly retryAt: Map<string, number> = new Map<string, number>();

  /**
   * Reads the current time. Overridable in tests.
   */
  protected now: () => number = Date.now;

  /**
   * Gets the open projects, in the order they were opened.
   */
  public readonly projects: Signal<readonly ForgeProject[]> = this.forgeProjects.projects;

  /**
   * Gets each project's state, keyed by project.
   */
  public readonly states: Signal<ReadonlyMap<string, ProjectWorkItems>> =
    this.stateMap.asReadonly();

  /**
   * Initializes a new instance of the {@link MissionControlWorkItems} class: while watching, a project
   * that opens is read at once, and a project that closes is forgotten.
   */
  public constructor() {
    effect((): void => {
      const projects: readonly ForgeProject[] = this.forgeProjects.projects();
      const watching: boolean = this.watching();
      untracked((): void => {
        this.forget(projects);
        if (watching) {
          for (const project of projects) {
            if (!this.stateMap().has(project.key)) {
              void this.refresh(project);
            }
          }
        }
      });
    });
  }

  /**
   * Gets one project's state.
   * @param key The project's key.
   * @returns Returns the state; a project nothing has been read for reports as unread.
   */
  public stateFor(key: string): ProjectWorkItems {
    return this.stateMap().get(key) ?? UNREAD;
  }

  /**
   * Starts or stops watching. Starting re-reads every project at once and then on a timer; stopping
   * cancels the timer and leaves the last trees in place for when watching resumes.
   * @param watching Whether anything is watching.
   */
  public setWatching(watching: boolean): void {
    if (watching === this.watching()) {
      return;
    }
    this.watching.set(watching);
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (watching) {
      this.refreshAll();
      this.timer = setInterval((): void => this.refreshAll(), WORK_ITEMS_REFRESH_MS);
    }
  }

  /**
   * Re-reads every open project.
   */
  public refreshAll(): void {
    for (const project of this.forgeProjects.projects()) {
      void this.refresh(project);
    }
  }

  /**
   * Re-reads one project's hierarchy. A read already in flight, or a rate limit not yet lifted, makes
   * this a no-op.
   * @param project The project to read.
   * @returns Returns a promise that resolves once the read has settled.
   */
  public async refresh(project: ForgeProject): Promise<void> {
    const current: ProjectWorkItems = this.stateFor(project.key);
    if (current.loading) {
      return;
    }
    const retryAt: number | undefined = this.retryAt.get(project.key);
    if (retryAt !== undefined && retryAt > this.now()) {
      return;
    }
    this.retryAt.delete(project.key);
    this.update(project.key, { ...current, loading: true });

    const result: ForgeResult<readonly ForgeWorkItem[]> = await this.forge.workItems(
      project.repository,
    );
    // The project may have closed while the read was in flight.
    if (!this.stateMap().has(project.key)) {
      return;
    }
    if (result.ok) {
      this.update(project.key, {
        tree: buildWorkItemTree(result.value),
        loaded: true,
        loading: false,
        error: null,
        unauthorized: false,
      });
      this.log.debug('mission-control', `Read ${result.value.length} work items`, project.key);
      return;
    }
    if (result.retryAt !== undefined) {
      this.retryAt.set(project.key, result.retryAt);
    }
    this.update(project.key, {
      ...this.stateFor(project.key),
      loading: false,
      error: result.error,
      unauthorized: result.unauthorized,
    });
    this.log.warn('mission-control', 'Could not read work items', project.key, result.error);
  }

  /**
   * Drops the state of every project no longer open, so a reopened project starts fresh and a closed
   * one holds nothing.
   * @param open The projects still open.
   */
  private forget(open: readonly ForgeProject[]): void {
    const keys: ReadonlySet<string> = new Set<string>(
      open.map((project: ForgeProject): string => project.key),
    );
    const current: ReadonlyMap<string, ProjectWorkItems> = this.stateMap();
    if ([...current.keys()].every((key: string): boolean => keys.has(key))) {
      return;
    }
    const next: Map<string, ProjectWorkItems> = new Map<string, ProjectWorkItems>();
    for (const [key, state] of current) {
      if (keys.has(key)) {
        next.set(key, state);
      } else {
        this.retryAt.delete(key);
      }
    }
    this.stateMap.set(next);
  }

  /**
   * Replaces one project's state.
   * @param key The project's key.
   * @param state The new state.
   */
  private update(key: string, state: ProjectWorkItems): void {
    this.stateMap.update(
      (current: ReadonlyMap<string, ProjectWorkItems>): ReadonlyMap<string, ProjectWorkItems> =>
        new Map<string, ProjectWorkItems>(current).set(key, state),
    );
  }
}
