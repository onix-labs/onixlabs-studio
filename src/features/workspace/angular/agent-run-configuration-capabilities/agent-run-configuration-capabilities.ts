import { inject, Service } from '@angular/core';
import {
  DELETE_RUN_CONFIGURATIONS,
  LIST_RUN_CONFIGURATIONS,
  SAVE_RUN_CONFIGURATIONS,
} from '@shared/api/ai-types';
import {
  findRunConfigurationIssues,
  parseRunConfiguration,
  RunConfiguration,
} from '@shared/api/studio';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { Log } from '@shared/angular/services/log/log';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';

/**
 * The result of the list capability.
 */
interface ListResult {
  /**
   * Gets a value indicating whether a workspace was open to read configurations from.
   */
  readonly available: boolean;

  /**
   * Gets the open workspace's root path, when one is open.
   */
  readonly root?: string;

  /**
   * Gets the workspace's run configurations (empty when none are authored).
   */
  readonly configurations: readonly RunConfiguration[];
}

/**
 * The result of a mutating capability (save or delete).
 */
interface WriteResult {
  /**
   * Gets a value indicating whether the write was applied.
   */
  readonly ok: boolean;

  /**
   * Gets the reason the write was refused, when it was.
   */
  readonly error?: string;

  /**
   * Gets the ids the write created, updated, or deleted.
   */
  readonly ids?: readonly string[];

  /**
   * Gets the full set of configurations after the write, so the agent sees the result without a
   * second call.
   */
  readonly configurations?: readonly RunConfiguration[];
}

/**
 * Registers the run-configuration agent capabilities with the {@link AiRuntime} registry: listing the
 * open workspace's `.studio` run configurations, creating or updating them, and deleting them. The
 * main-process agent providers invoke these by name over the renderer bridge, which is how the
 * Configure dialog's Auto and Prompt buttons do their work — the agent investigates the project and
 * writes what it finds through these tools, rather than Studio guessing from manifests.
 *
 * They are registered here, in the renderer, rather than written straight to disk in the main process,
 * so a write goes through the same {@link StudioConfig} the UI reads: the Run dropdown and the
 * Configure dialog update the moment the agent saves, with no reload and no file-watch race.
 *
 * Every write is validated as a whole ({@link findRunConfigurationIssues}) before it is persisted, so
 * a compound naming a member that does not exist is refused with a message the agent can act on
 * instead of landing a broken file on disk.
 */
@Service()
export class AgentRunConfigurationCapabilities {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the agent runtime the capabilities register with.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the active workspace's `.studio` persistence, read and written by these capabilities.
   */
  private readonly studio: StudioConfig = inject(StudioConfig);

  /**
   * Holds the active-workspace seam, used to report which workspace the agent is authoring for.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Initializes a new instance of the {@link AgentRunConfigurationCapabilities} class, registering the
   * run-configuration capabilities.
   */
  public constructor() {
    this.runtime.registerCapability(LIST_RUN_CONFIGURATIONS, (): ListResult => this.list());
    this.runtime.registerCapability(
      SAVE_RUN_CONFIGURATIONS,
      (input: unknown): Promise<WriteResult> => this.save(input),
    );
    this.runtime.registerCapability(
      DELETE_RUN_CONFIGURATIONS,
      (input: unknown): Promise<WriteResult> => this.remove(input),
    );
  }

  /**
   * Lists the open workspace's run configurations.
   * @returns Returns the {@link ListResult}.
   */
  private list(): ListResult {
    const root: string | null = this.activeWorkspace.rootPath();
    if (root === null) {
      return { available: false, configurations: [] };
    }
    return { available: true, root, configurations: this.studio.runConfigurations() };
  }

  /**
   * Creates or updates run configurations, matching by id: a known id is replaced in place (so the
   * user's ordering is preserved), an unknown one is appended.
   * @param input The capability input, carrying a `configurations` array.
   * @returns Returns the {@link WriteResult}.
   */
  private async save(input: unknown): Promise<WriteResult> {
    const root: string | null = this.activeWorkspace.rootPath();
    if (root === null) {
      return { ok: false, error: 'No workspace folder is open, so there is nowhere to save.' };
    }
    const raw: readonly unknown[] = this.arrayOf(input, 'configurations');
    if (raw.length === 0) {
      return { ok: false, error: 'No configurations were supplied.' };
    }
    const incoming: RunConfiguration[] = [];
    for (const [index, value] of raw.entries()) {
      const parsed: RunConfiguration | null = parseRunConfiguration(value);
      if (parsed === null) {
        return {
          ok: false,
          error:
            `Configuration ${index + 1} is missing a required field: every configuration needs a ` +
            'non-empty id, name, and providerKind (a compound may omit providerKind).',
        };
      }
      incoming.push(parsed);
    }

    const merged: RunConfiguration[] = [...this.studio.runConfigurations()];
    for (const configuration of incoming) {
      const existing: number = merged.findIndex(
        (candidate: RunConfiguration): boolean => candidate.id === configuration.id,
      );
      if (existing >= 0) {
        merged[existing] = configuration;
      } else {
        merged.push(configuration);
      }
    }

    const issues: readonly string[] = findRunConfigurationIssues(merged);
    if (issues.length > 0) {
      return { ok: false, error: `The configurations were not saved: ${issues.join(' ')}` };
    }

    await this.studio.saveRunConfigurations(merged);
    this.log.info('workspace.run', 'Agent saved run configurations', incoming.length);
    return {
      ok: true,
      ids: incoming.map((configuration: RunConfiguration): string => configuration.id),
      configurations: merged,
    };
  }

  /**
   * Deletes run configurations by id. Ids that do not exist are reported rather than silently ignored,
   * so the agent can tell a typo from a completed deletion. A deletion that would leave a compound
   * naming a missing member is refused, keeping the file sound.
   * @param input The capability input, carrying an `ids` array.
   * @returns Returns the {@link WriteResult}.
   */
  private async remove(input: unknown): Promise<WriteResult> {
    const root: string | null = this.activeWorkspace.rootPath();
    if (root === null) {
      return { ok: false, error: 'No workspace folder is open, so there is nothing to delete.' };
    }
    const ids: readonly string[] = this.arrayOf(input, 'ids').filter(
      (id: unknown): id is string => typeof id === 'string' && id.length > 0,
    );
    if (ids.length === 0) {
      return { ok: false, error: 'No configuration ids were supplied.' };
    }
    const current: readonly RunConfiguration[] = this.studio.runConfigurations();
    const missing: readonly string[] = ids.filter(
      (id: string): boolean =>
        !current.some((configuration: RunConfiguration): boolean => configuration.id === id),
    );
    if (missing.length > 0) {
      return { ok: false, error: `No run configuration exists with id: ${missing.join(', ')}.` };
    }

    const remaining: readonly RunConfiguration[] = current.filter(
      (configuration: RunConfiguration): boolean => !ids.includes(configuration.id),
    );
    const issues: readonly string[] = findRunConfigurationIssues(remaining);
    if (issues.length > 0) {
      return { ok: false, error: `The configurations were not deleted: ${issues.join(' ')}` };
    }

    await this.studio.saveRunConfigurations(remaining);
    this.log.info('workspace.run', 'Agent deleted run configurations', ids.length);
    return { ok: true, ids, configurations: remaining };
  }

  /**
   * Reads an array field from an untrusted capability input.
   * @param input The capability input.
   * @param key The field name.
   * @returns Returns the array, or an empty array when absent or malformed.
   */
  private arrayOf(input: unknown, key: string): readonly unknown[] {
    if (typeof input !== 'object' || input === null) {
      return [];
    }
    const value: unknown = (input as Record<string, unknown>)[key];
    return Array.isArray(value) ? value : [];
  }
}
