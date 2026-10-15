import * as os from 'node:os';
import {
  DELETE_MODEL,
  DELETE_PROMPT_PROFILE,
  DELETE_SKILL,
  DOWNLOAD_MODEL,
  LIST_LOCAL_MODELS,
  LIST_PROMPT_PROFILES,
  LIST_SKILL_TAGS,
  LIST_SKILLS,
  READ_MACHINE_FACTS,
  READ_SKILL,
  SAVE_PROMPT_PROFILE,
  SAVE_SKILL,
  SEARCH_MODEL_CATALOG,
} from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
import type { AgentRunContext } from './agent-provider';

// The AI Manager agent's tools (#967): local models, prompt profiles and skills. Every handler but the
// machine facts asks the renderer, which acts through the same services the view's own controls use,
// so the view shows what the agent did the moment it does it. The answers are rendered as JSON: they
// are structured lists the model reads back field by field.

/**
 * Appended to the system prompt for an AI Manager run, so the model knows what it is docked to, what
 * it can reach, and what it is not for.
 */
export const AI_MANAGER_PROMPT_APPENDIX: string = [
  'You are running inside ONIXLabs Studio, docked to the AI Manager: the local models the user runs',
  'on this machine, their prompt profiles (standing instructions for agents) and their skill library',
  '(instructions an agent loads when a task needs them). You can:',
  `- "${LIST_LOCAL_MODELS}" lists the local runtime, its installed and running models and disk use.`,
  `- "${SEARCH_MODEL_CATALOG}" searches the catalogue of models that can be downloaded.`,
  `- "${READ_MACHINE_FACTS}" reports the machine's memory, processor and architecture.`,
  `- "${DOWNLOAD_MODEL}" starts a download; "${DELETE_MODEL}" deletes an installed model.`,
  `- "${LIST_PROMPT_PROFILES}", "${SAVE_PROMPT_PROFILE}" and "${DELETE_PROMPT_PROFILE}" manage profiles.`,
  `- "${LIST_SKILLS}", "${READ_SKILL}", "${SAVE_SKILL}" and "${DELETE_SKILL}" manage skills.`,
  `- "${LIST_SKILL_TAGS}" lists what a skill can be scoped to and tagged with.`,
  'Choosing a model: read the machine facts first, then suggest models that fit — a model needs',
  'roughly its download size in free memory to run well. Before downloading, search the catalogue and',
  'tell the user the size; download only what they asked for.',
  'Writing a skill: give it a lower-case hyphenated name, a description that says what kind of task',
  'it is for (the agent reads only that until it loads the skill), and instructions in Markdown. Tag',
  `it only with ids "${LIST_SKILL_TAGS}" returns — languages narrow it to that language in the`,
  'editor; technologies let Create Something suggest it — and leave a general skill untagged.',
  'Writing a profile: keep it to standing preferences that apply to every conversation in its scope.',
  'Read what is there before changing it, and never delete without the user asking.',
  'You are kept to this view. You cannot read or change files, run commands, or act anywhere else in',
  'Studio. When the user asks for something outside it, say which part of Studio can help instead.',
].join('\n');

/**
 * Asks the renderer for something and renders the answer for the model.
 * @param context The agent run context (carries the bridge).
 * @param name The capability.
 * @param input What to send.
 * @param done How to describe a success, given the answer.
 * @returns Returns the rendered answer.
 */
async function ask(
  context: AgentRunContext,
  name: string,
  input: Record<string, unknown>,
  done: (answer: Record<string, unknown>) => string = (answer: Record<string, unknown>): string =>
    JSON.stringify(answer['result'] ?? {}, null, 2),
): Promise<string> {
  logger.trace('AiManagerTools', `Tool invoked: ${name}`);
  const result: unknown = await context.bridge.request(name, input);
  const answer: Record<string, unknown> =
    result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  if (answer['available'] !== true) {
    return 'The AI Manager is not open, so it cannot be reached.';
  }
  if (typeof answer['error'] === 'string') {
    logger.debug('AiManagerTools', `${name} refused: ${answer['error']}`);
    return answer['error'];
  }
  return done(answer);
}

/**
 * Lists the local runtime and its models.
 * @param context The agent run context.
 * @returns Returns the listing.
 */
export function listLocalModels(context: AgentRunContext): Promise<string> {
  return ask(context, LIST_LOCAL_MODELS, {});
}

/**
 * Searches the model catalogue.
 * @param context The agent run context.
 * @param query What to search for.
 * @param limit How many results, at most.
 * @returns Returns the matches.
 */
export function searchModelCatalog(
  context: AgentRunContext,
  query: string,
  limit: number | undefined,
): Promise<string> {
  return ask(context, SEARCH_MODEL_CATALOG, {
    query,
    limit: Math.min(50, Math.max(1, limit ?? 20)),
  });
}

/**
 * Reports what the machine can run. Read here, in the main process, which can see the machine.
 * @returns Returns the facts.
 */
export function readMachineFacts(): string {
  logger.trace('AiManagerTools', `Tool invoked: ${READ_MACHINE_FACTS}`);
  const cpus: os.CpuInfo[] = os.cpus();
  const gib: (bytes: number) => number = (bytes: number): number =>
    Math.round((bytes / 1024 ** 3) * 10) / 10;
  return JSON.stringify(
    {
      platform: process.platform,
      architecture: process.arch,
      // Apple silicon shares one pool of memory between the processor and the GPU, which is what lets
      // a Mac run a model as large as its memory allows rather than as large as a graphics card holds.
      unifiedMemory: process.platform === 'darwin' && process.arch === 'arm64',
      memoryGiB: gib(os.totalmem()),
      freeMemoryGiB: gib(os.freemem()),
      processor: cpus[0]?.model ?? 'unknown',
      cores: cpus.length,
    },
    null,
    2,
  );
}

/**
 * Starts downloading a model.
 * @param context The agent run context.
 * @param ref The catalogue reference.
 * @returns Returns a confirmation that it started, or why it did not.
 */
export function downloadModel(context: AgentRunContext, ref: string): Promise<string> {
  return ask(
    context,
    DOWNLOAD_MODEL,
    { ref },
    (): string =>
      `Started downloading ${ref}. It shows its progress in the AI Manager, and is added to the model picker when it finishes.`,
  );
}

/**
 * Deletes an installed model.
 * @param context The agent run context.
 * @param name The model's name.
 * @returns Returns a confirmation, or why it was not deleted.
 */
export function deleteModel(context: AgentRunContext, name: string): Promise<string> {
  return ask(context, DELETE_MODEL, { name }, (): string => `Deleted ${name}.`);
}

/**
 * Lists the prompt profiles.
 * @param context The agent run context.
 * @returns Returns the profiles.
 */
export function listPromptProfiles(context: AgentRunContext): Promise<string> {
  return ask(context, LIST_PROMPT_PROFILES, {});
}

/**
 * Creates or changes a prompt profile.
 * @param context The agent run context.
 * @param profile The profile's fields.
 * @returns Returns a confirmation, or why it was refused.
 */
export function savePromptProfile(
  context: AgentRunContext,
  profile: Record<string, unknown>,
): Promise<string> {
  return ask(
    context,
    SAVE_PROMPT_PROFILE,
    profile,
    (answer: Record<string, unknown>): string =>
      `${answer['created'] === true ? 'Created' : 'Updated'} the profile "${String(answer['name'])}" (id ${String(answer['id'])}).`,
  );
}

/**
 * Deletes a prompt profile.
 * @param context The agent run context.
 * @param id The profile's id.
 * @returns Returns a confirmation, or why it was not deleted.
 */
export function deletePromptProfile(context: AgentRunContext, id: string): Promise<string> {
  return ask(context, DELETE_PROMPT_PROFILE, { id }, (): string => `Deleted profile ${id}.`);
}

/**
 * Lists the skill library.
 * @param context The agent run context.
 * @returns Returns the skills.
 */
export function listSkills(context: AgentRunContext): Promise<string> {
  return ask(context, LIST_SKILLS, {});
}

/**
 * Reads one skill's instructions.
 * @param context The agent run context.
 * @param name The skill's name.
 * @returns Returns the skill.
 */
export function readSkill(context: AgentRunContext, name: string): Promise<string> {
  return ask(context, READ_SKILL, { name });
}

/**
 * Lists what a skill can be scoped to and tagged with.
 * @param context The agent run context.
 * @returns Returns the surfaces and the tags by category.
 */
export function listSkillTags(context: AgentRunContext): Promise<string> {
  return ask(context, LIST_SKILL_TAGS, {});
}

/**
 * Creates or changes a skill.
 * @param context The agent run context.
 * @param skill The skill's fields.
 * @returns Returns a confirmation, or why it was refused.
 */
export function saveSkill(
  context: AgentRunContext,
  skill: Record<string, unknown>,
): Promise<string> {
  return ask(
    context,
    SAVE_SKILL,
    skill,
    (answer: Record<string, unknown>): string =>
      `Saved the skill "${String(answer['name'])}". It is in the Skill Library.`,
  );
}

/**
 * Deletes a skill.
 * @param context The agent run context.
 * @param name The skill's name.
 * @returns Returns a confirmation, or why it was not deleted.
 */
export function deleteSkill(context: AgentRunContext, name: string): Promise<string> {
  return ask(context, DELETE_SKILL, { name }, (): string => `Deleted the skill "${name}".`);
}
