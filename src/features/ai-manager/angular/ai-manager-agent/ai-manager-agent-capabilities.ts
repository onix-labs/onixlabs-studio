import { DestroyRef, inject, Service } from '@angular/core';
import {
  AGENT_SURFACES,
  type AgentSurface,
  type AiBridgeScope,
  DELETE_MODEL,
  DELETE_PROMPT_PROFILE,
  DELETE_SKILL,
  DOWNLOAD_MODEL,
  LIST_LOCAL_MODELS,
  LIST_PROMPT_PROFILES,
  LIST_SKILL_TAGS,
  LIST_SKILLS,
  normalizeLanguage,
  READ_SKILL,
  SAVE_PROMPT_PROFILE,
  SAVE_SKILL,
  SEARCH_MODEL_CATALOG,
} from '@shared/api/ai-types';
import type { CatalogModel, CatalogResult } from '@shared/api/model-catalog-types';
import type { ModelRuntimeStatus } from '@shared/api/model-runtime-types';
import type { Skill, SkillDraft, SkillSaveResult } from '@shared/api/skill-channels';
import { AiManagerNavigation } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import {
  PromptProfile,
  PromptProfiles,
} from '@shared/angular/services/prompt-profiles/prompt-profiles';
import { Skills } from '@shared/angular/services/skills/skills';
import { ModelConnections } from '../model-connections/model-connections';
import { ModelManagerCommands } from '../model-manager-commands/model-manager-commands';
import { ModelRuntimes } from '../model-runtime/model-runtimes';
import { OFFERED_TAGS, SKILL_TAG_OPTIONS, splitSkillTags } from '../skill-tags/skill-tags';

/**
 * An answer to the agent: the run is not the AI Manager's, a refusal, or a result.
 */
type Answer =
  | { readonly available: false }
  | { readonly available: true; readonly error: string }
  | ({ readonly available: true } & Record<string, unknown>);

/**
 * Reads a record out of untrusted input.
 * @param input The input.
 * @returns Returns the record, or an empty one.
 */
function recordOf(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

/**
 * Reads a string field, or undefined when it is absent or not a string.
 * @param record The record.
 * @param key The field.
 * @returns Returns the string.
 */
function text(record: Record<string, unknown>, key: string): string | undefined {
  const value: unknown = record[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads a list of strings, or undefined when the field is absent.
 * @param record The record.
 * @param key The field.
 * @returns Returns the strings.
 */
function strings(record: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value: unknown = record[key];
  return Array.isArray(value)
    ? value.filter((entry: unknown): entry is string => typeof entry === 'string')
    : undefined;
}

/**
 * Reads a list of surfaces, dropping any that are not one.
 * @param record The record.
 * @returns Returns the surfaces, or undefined when the field is absent.
 */
function surfacesOf(record: Record<string, unknown>): readonly AgentSurface[] | undefined {
  return strings(record, 'surfaces')?.filter((value: string): value is AgentSurface =>
    AGENT_SURFACES.includes(value as AgentSurface),
  );
}

/**
 * Refuses a request with a reason.
 * @param error The reason.
 * @returns Returns the refusal.
 */
function refuse(error: string): Answer {
  return { available: true, error };
}

/**
 * The AI Manager agent's capabilities (#967): the local models, the prompt profiles and the skill
 * library, each acted on through the same service the view's own controls use — so the view shows
 * what the agent did, and the agent can do nothing the view could not.
 *
 * Provided by the AI Manager view, so they exist only while it is open, and each answers only a run
 * on the `models` surface.
 */
@Service()
export class AiManagerAgentCapabilities {
  /**
   * Holds the local model runtime client.
   */
  private readonly runtimes: ModelRuntimes = inject(ModelRuntimes);

  /**
   * Holds the link between installed models and the model picker.
   */
  private readonly links: ModelConnections = inject(ModelConnections);

  /**
   * Holds the Local Models sub-view's commands, so it shows a change the agent made.
   */
  private readonly modelCommands: ModelManagerCommands = inject(ModelManagerCommands);

  /**
   * Holds the prompt profiles.
   */
  private readonly profiles: PromptProfiles = inject(PromptProfiles);

  /**
   * Holds the skill library.
   */
  private readonly skills: Skills = inject(Skills);

  /**
   * Holds the AI Manager's section, switched to show what the agent just changed.
   */
  private readonly navigation: AiManagerNavigation = inject(AiManagerNavigation);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Registers the capabilities, and releases them with the view.
   */
  public constructor() {
    const runtime: AiRuntime = inject(AiRuntime);
    const handlers: Readonly<Record<string, (input: unknown) => Answer | Promise<Answer>>> = {
      [LIST_LOCAL_MODELS]: (): Promise<Answer> => this.listModels(),
      [SEARCH_MODEL_CATALOG]: (input: unknown): Promise<Answer> => this.search(input),
      [DOWNLOAD_MODEL]: (input: unknown): Promise<Answer> => this.download(input),
      [DELETE_MODEL]: (input: unknown): Promise<Answer> => this.deleteModel(input),
      [LIST_PROMPT_PROFILES]: (): Answer => this.listProfiles(),
      [SAVE_PROMPT_PROFILE]: (input: unknown): Answer => this.saveProfile(input),
      [DELETE_PROMPT_PROFILE]: (input: unknown): Answer => this.deleteProfile(input),
      [LIST_SKILLS]: (): Answer => this.listSkills(),
      [READ_SKILL]: (input: unknown): Answer => this.readSkill(input),
      [LIST_SKILL_TAGS]: (): Answer => this.listTags(),
      [SAVE_SKILL]: (input: unknown): Promise<Answer> => this.saveSkill(input),
      [DELETE_SKILL]: (input: unknown): Promise<Answer> => this.deleteSkill(input),
    };
    const releases: readonly (() => void)[] = Object.entries(handlers).map(
      ([name, handler]: [string, (input: unknown) => Answer | Promise<Answer>]): (() => void) =>
        runtime.registerCapability(
          name,
          (input: unknown, scope: AiBridgeScope): Answer | Promise<Answer> =>
            scope.surface === 'models' ? handler(input) : { available: false },
        ),
    );
    inject(DestroyRef).onDestroy((): void => {
      for (const release of releases) {
        release();
      }
    });
  }

  /**
   * Lists the runtime and its models.
   * @returns Returns the listing.
   */
  private async listModels(): Promise<Answer> {
    const status: ModelRuntimeStatus = await this.runtimes.status();
    if (!status.available) {
      return {
        available: true,
        result: { runtime: 'not running', installed: [], running: [] },
      };
    }
    const [installed, running, disk] = await Promise.all([
      this.runtimes.list(),
      this.runtimes.running(),
      this.runtimes.diskUsage(),
    ]);
    return {
      available: true,
      result: {
        runtime: { running: true, version: status.version ?? null },
        diskUsedBytes: disk.bytes,
        installed: installed.map((model) => ({
          name: model.name,
          sizeBytes: model.size,
          family: model.family,
          parameters: model.parameterSize,
        })),
        running: running.map((model) => ({ name: model.name, sizeBytes: model.size })),
      },
    };
  }

  /**
   * Searches the catalogue.
   * @param input The request.
   * @returns Returns the matches.
   */
  private async search(input: unknown): Promise<Answer> {
    const request: Record<string, unknown> = recordOf(input);
    const limit: unknown = request['limit'];
    const found: CatalogResult = await this.runtimes.searchCatalog(
      text(request, 'query') ?? '',
      typeof limit === 'number' ? limit : 20,
    );
    return {
      available: true,
      result: {
        models: found.models.map((model: CatalogModel) => ({
          ref: model.ref,
          name: model.name,
          category: model.category,
          parameters: model.parameterSize,
          sizeBytes: model.sizeBytes,
          description: model.description,
        })),
        ...(found.failedSources.length === 0 ? {} : { unreachable: found.failedSources }),
      },
    };
  }

  /**
   * Starts a download, which runs on after the answer: a model can take minutes, and the view shows
   * its progress. A finished download is linked to the model picker, as one the user starts is.
   * @param input The request.
   * @returns Returns whether it started.
   */
  private async download(input: unknown): Promise<Answer> {
    const ref: string = (text(recordOf(input), 'ref') ?? '').trim();
    if (ref.length === 0) {
      return refuse('Name the model to download.');
    }
    if (!(await this.runtimes.status()).available) {
      return refuse('The local model runtime is not running. Start it from the ribbon first.');
    }
    this.navigation.show('models');
    this.log.info('aiManager.agent', `Agent started downloading '${ref}'`);
    void this.runtimes.pull(ref).then(async (pulled: boolean): Promise<void> => {
      if (pulled) {
        await this.links.linkInstalled(ref);
      }
      this.modelCommands.refresh();
    });
    return { available: true, started: true };
  }

  /**
   * Deletes an installed model.
   * @param input The request.
   * @returns Returns the outcome.
   */
  private async deleteModel(input: unknown): Promise<Answer> {
    const name: string = (text(recordOf(input), 'name') ?? '').trim();
    if (!(await this.runtimes.remove(name))) {
      return refuse(`"${name}" could not be deleted. List the installed models to check its name.`);
    }
    this.links.unlinkRemoved(name);
    this.modelCommands.refresh();
    this.log.info('aiManager.agent', `Agent deleted model '${name}'`);
    return { available: true, deleted: true };
  }

  /**
   * Lists the prompt profiles.
   * @returns Returns them.
   */
  private listProfiles(): Answer {
    return { available: true, result: this.profiles.profiles() };
  }

  /**
   * Creates a profile, or changes one, and shows the profiles.
   * @param input The request.
   * @returns Returns the outcome.
   */
  private saveProfile(input: unknown): Answer {
    const request: Record<string, unknown> = recordOf(input);
    const id: string | undefined = text(request, 'id');
    const existing: PromptProfile | undefined =
      id === undefined
        ? undefined
        : this.profiles.profiles().find((profile: PromptProfile): boolean => profile.id === id);
    if (id !== undefined && existing === undefined) {
      return refuse(`There is no profile with the id "${id}". List the profiles to find it.`);
    }
    const profile: PromptProfile = existing ?? this.profiles.create(text(request, 'name'));
    const surfaces: readonly AgentSurface[] | undefined = surfacesOf(request);
    const languages: readonly string[] | undefined = strings(request, 'languages')?.map(
      normalizeLanguage,
    );
    const enabled: unknown = request['enabled'];
    this.profiles.update(profile.id, {
      ...(text(request, 'name') === undefined ? {} : { name: text(request, 'name')!.trim() }),
      ...(text(request, 'instructions') === undefined
        ? {}
        : { instructions: text(request, 'instructions') }),
      scope: {
        surfaces: surfaces ?? profile.scope.surfaces,
        languages: languages ?? profile.scope.languages,
      },
      ...(typeof enabled === 'boolean' ? { enabled } : {}),
    });
    this.navigation.show('profiles');
    const saved: PromptProfile | undefined = this.profiles
      .profiles()
      .find((candidate: PromptProfile): boolean => candidate.id === profile.id);
    return { available: true, created: existing === undefined, id: profile.id, name: saved?.name };
  }

  /**
   * Deletes a profile.
   * @param input The request.
   * @returns Returns the outcome.
   */
  private deleteProfile(input: unknown): Answer {
    const id: string = text(recordOf(input), 'id') ?? '';
    if (!this.profiles.profiles().some((profile: PromptProfile): boolean => profile.id === id)) {
      return refuse(`There is no profile with the id "${id}".`);
    }
    this.profiles.delete(id);
    return { available: true, deleted: true };
  }

  /**
   * Lists the skills, without their instructions.
   * @returns Returns them.
   */
  private listSkills(): Answer {
    return {
      available: true,
      result: this.skills.skills().map((skill: Skill) => ({
        name: skill.name,
        description: skill.description,
        surfaces: skill.scope.surfaces,
        tags: [...skill.scope.languages, ...skill.technologies],
        enabled: skill.enabled,
        problem: skill.problem,
      })),
    };
  }

  /**
   * Reads one skill in full.
   * @param input The request.
   * @returns Returns the skill.
   */
  private readSkill(input: unknown): Answer {
    const skill: Skill | undefined = this.find(text(recordOf(input), 'name') ?? '');
    if (skill === undefined) {
      return refuse('There is no skill by that name. List the skills to find it.');
    }
    return {
      available: true,
      result: {
        name: skill.name,
        description: skill.description,
        surfaces: skill.scope.surfaces,
        tags: [...skill.scope.languages, ...skill.technologies],
        enabled: skill.enabled,
        instructions: skill.body,
        files: skill.files,
      },
    };
  }

  /**
   * Lists what a skill can be scoped to and tagged with.
   * @returns Returns the surfaces, and the tags by category.
   */
  private listTags(): Answer {
    const tags: Record<string, { id: string; name: string }[]> = {};
    for (const option of SKILL_TAG_OPTIONS) {
      (tags[option.group ?? 'Other'] ??= []).push({ id: option.value, name: option.label });
    }
    return { available: true, result: { surfaces: AGENT_SURFACES, tags } };
  }

  /**
   * Creates a skill, or changes one, and shows the library. Tags the list does not offer are refused
   * rather than written, so the editor can always show what the agent chose.
   * @param input The request.
   * @returns Returns the outcome.
   */
  private async saveSkill(input: unknown): Promise<Answer> {
    const request: Record<string, unknown> = recordOf(input);
    const name: string = (text(request, 'name') ?? '').trim().toLowerCase();
    const previousName: string | undefined = text(request, 'previous_name');
    const existing: Skill | undefined = this.find(previousName ?? name);
    if (previousName !== undefined && existing === undefined) {
      return refuse(`There is no skill named "${previousName}" to rename.`);
    }
    const tags: readonly string[] | undefined = strings(request, 'tags');
    const unknown: readonly string[] = (tags ?? []).filter(
      (id: string): boolean => !OFFERED_TAGS.has(id),
    );
    if (unknown.length > 0) {
      return refuse(
        `These are not tags a skill can have: ${unknown.join(', ')}. Use ids from list_skill_tags.`,
      );
    }
    const split: { languages: readonly string[]; technologies: readonly string[] } =
      tags === undefined
        ? {
            languages: existing?.scope.languages ?? [],
            technologies: existing?.technologies ?? [],
          }
        : splitSkillTags(tags, existing?.scope.languages ?? [], existing?.technologies ?? []);
    const enabled: unknown = request['enabled'];
    const draft: SkillDraft = {
      name,
      ...(existing !== undefined && existing.name !== name ? { previousName: existing.name } : {}),
      description: text(request, 'description') ?? existing?.description ?? '',
      scope: {
        surfaces: surfacesOf(request) ?? existing?.scope.surfaces ?? [],
        languages: split.languages,
      },
      technologies: split.technologies,
      enabled: typeof enabled === 'boolean' ? enabled : (existing?.enabled ?? true),
      body: text(request, 'instructions') ?? existing?.body ?? '',
    };
    const result: SkillSaveResult = await this.skills.save(draft);
    if (result.error !== null) {
      return refuse(result.error);
    }
    this.navigation.show('skills');
    this.log.info('aiManager.agent', `Agent saved skill '${name}'`);
    return { available: true, name: result.skill?.name ?? name };
  }

  /**
   * Deletes a skill.
   * @param input The request.
   * @returns Returns the outcome.
   */
  private async deleteSkill(input: unknown): Promise<Answer> {
    const skill: Skill | undefined = this.find(text(recordOf(input), 'name') ?? '');
    if (skill === undefined) {
      return refuse('There is no skill by that name.');
    }
    await this.skills.delete(skill.name);
    this.log.info('aiManager.agent', `Agent deleted skill '${skill.name}'`);
    return { available: true, deleted: true };
  }

  /**
   * Finds a skill by name, ignoring case.
   * @param name The name.
   * @returns Returns the skill, or undefined.
   */
  private find(name: string): Skill | undefined {
    const wanted: string = name.trim().toLowerCase();
    return this.skills.skills().find((skill: Skill): boolean => skill.name === wanted);
  }
}
