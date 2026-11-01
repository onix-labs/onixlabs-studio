import { inject, Service } from '@angular/core';
import type { AiProviderId } from '@shared/api/ai-types';
import {
  SKILL_DESCRIPTION_LIMIT,
  SKILL_DESCRIPTION_TARGET,
  SKILL_NAME_PATTERN,
} from '@shared/api/skill-channels';
import { parseSkillFile, type ParsedSkillFile } from '@shared/api/skill-file';
import type { SkillImportDraft } from '@shared/api/skill-import-channels';
import { AiOneShot, AiOneShotResult } from '@shared/angular/services/ai-runtime/ai-one-shot';
import { Log } from '@shared/angular/services/log/log';
import { OFFERED_TAGS, splitSkillTags } from '../skill-tags/skill-tags';

/**
 * How long one rewrite may take. A skill can run to hundreds of lines, all of which come back.
 */
const ASSIST_TIMEOUT_MS: number = 10 * 60_000;

/**
 * The longest body handed to an AI, so one huge file cannot overrun a model's context.
 */
const ASSIST_BODY_LIMIT: number = 120_000;

/**
 * Where an assist runs: the connection and model chosen in the AI Manager's agent panel.
 */
export interface SkillAssistModel {
  /**
   * Gets the provider.
   */
  readonly providerId: AiProviderId;

  /**
   * Gets the model, or empty for the provider's default.
   */
  readonly model: string;
}

/**
 * What an assist produced:
 * - `draft`: the AI's version of the skill.
 * - `not-a-skill`: the AI judged the file unusable as a skill, and why.
 * - `error`: no usable answer, and why.
 */
export type SkillAssistResult =
  | { readonly kind: 'draft'; readonly draft: SkillImportDraft }
  | { readonly kind: 'not-a-skill'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };

/**
 * Has an AI turn a file into a skill, or bring an existing skill up to date (#1263). The model is asked
 * for a whole `SKILL.md` and its answer is read with the library's own parser, so what comes back is
 * held to the rules a file on disk is.
 */
@Service()
export class SkillAssist {
  /**
   * Holds the one-shot runner.
   */
  private readonly oneShot: AiOneShot = inject(AiOneShot);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets whether an AI can be asked here at all.
   */
  public readonly isAvailable: boolean = this.oneShot.isAvailable;

  /**
   * Turns a file the importer could not use as it is into a skill.
   * @param source The file's path, for the model's context.
   * @param draft What the importer drafted from it.
   * @param reason Why it could not be used as it is.
   * @param model Where to run.
   * @param signal Aborts the run.
   * @returns Returns the result.
   */
  public repair(
    source: string,
    draft: SkillImportDraft,
    reason: string,
    model: SkillAssistModel,
    signal?: AbortSignal,
  ): Promise<SkillAssistResult> {
    return this.ask(
      [
        "Convert the Markdown document below into a skill for an AI coding agent's skill library.",
        '',
        ...this.format(draft.name),
        '',
        `The importer could not use the file as it is: ${reason}`,
        '',
        'Rules for the body:',
        "- Keep the document's content, structure and wording; change only what it needs to stand as a skill.",
        '- Keep every relative link exactly as written.',
        '',
        'If the document is not something an agent could use as a skill (a README, a licence, a changelog,',
        'an index of other files), reply with exactly one line: NOT A SKILL: <a short reason>',
        '',
        'Otherwise reply with ONLY the complete SKILL.md, starting with the --- line. No code fences, no commentary.',
        '',
        `Source file: ${source}`,
        '<<<',
        draft.body,
        '>>>',
      ].join('\n'),
      draft,
      model,
      signal,
    );
  }

  /**
   * Brings a skill up to date and sharpens its description.
   * @param draft The skill as it stands.
   * @param model Where to run.
   * @param signal Aborts the run.
   * @returns Returns the result.
   */
  public improve(
    draft: SkillImportDraft,
    model: SkillAssistModel,
    signal?: AbortSignal,
  ): Promise<SkillAssistResult> {
    return this.ask(
      [
        `Improve this skill from an AI coding agent's skill library. Today is ${new Date().toISOString().slice(0, 10)}.`,
        '',
        ...this.format(draft.name),
        '',
        'What to change:',
        '- Correct anything outdated or wrong for current versions of the technologies it covers, and fill obvious gaps.',
        '- Sharpen the description so an agent can tell from it alone when to load the skill.',
        "- Keep the skill's structure, voice and scope. Do not pad it; shorter is fine where it was verbose.",
        '- Keep every relative link exactly as written.',
        `- Keep the name "${draft.name}" unless it is misleading.`,
        '',
        'Reply with ONLY the complete SKILL.md, starting with the --- line. No code fences, no commentary.',
        '',
        'The skill as it stands:',
        '<<<',
        '---',
        `name: ${draft.name}`,
        `description: ${JSON.stringify(draft.description)}`,
        ...(draft.scope.languages.length > 0
          ? [`languages: [${draft.scope.languages.join(', ')}]`]
          : []),
        ...(draft.technologies.length > 0
          ? [`technologies: [${draft.technologies.join(', ')}]`]
          : []),
        '---',
        draft.body,
        '>>>',
      ].join('\n'),
      draft,
      model,
      signal,
    );
  }

  /**
   * Describes the `SKILL.md` format the model must answer in.
   * @param name The suggested name.
   * @returns Returns the lines.
   */
  private format(name: string): string[] {
    return [
      'A skill is a SKILL.md file: YAML front-matter between --- lines, then a Markdown body. Front-matter keys:',
      `- name: lower-case letters, digits and hyphens, at most 64 characters. Suggested: "${name}".`,
      `- description: one or two sentences, at most ${SKILL_DESCRIPTION_TARGET} characters, in double quotes, saying what the skill covers and WHEN an agent should load it. It is all the agent sees before deciding, and it is sent on every turn, so keep it short.`,
      '- languages: an optional [list] of editor-language ids the skill is specifically about.',
      '- technologies: an optional [list] of technology ids the skill is specifically about.',
      `Language and technology ids must come from this list; leave them out when the skill is general: ${[...OFFERED_TAGS].join(', ')}`,
    ];
  }

  /**
   * Runs a prompt and reads the answer as a skill.
   * @param prompt The prompt.
   * @param fallback The draft the answer improves on, whose fields stand in for any it leaves out.
   * @param model Where to run.
   * @param signal Aborts the run.
   * @returns Returns the result.
   */
  private async ask(
    prompt: string,
    fallback: SkillImportDraft,
    model: SkillAssistModel,
    signal?: AbortSignal,
  ): Promise<SkillAssistResult> {
    if (fallback.body.length > ASSIST_BODY_LIMIT) {
      return { kind: 'error', reason: 'The file is too large to hand to an AI in one go.' };
    }
    const answer: AiOneShotResult = await this.oneShot.complete({
      providerId: model.providerId,
      model: model.model,
      prompt,
      surface: 'models',
      timeoutMs: ASSIST_TIMEOUT_MS,
      signal,
    });
    if (answer.error !== null) {
      this.log.warn('SkillAssist', `No answer: ${answer.error}`);
      return { kind: 'error', reason: answer.error };
    }
    return readAnswer(answer.text, fallback);
  }
}

/**
 * Reads a model's answer as a skill.
 * @param text The answer.
 * @param fallback The draft whose fields stand in for any the answer leaves out.
 * @returns Returns the result.
 */
export function readAnswer(text: string, fallback: SkillImportDraft): SkillAssistResult {
  let answer: string = text.trim();
  const fence: RegExpExecArray | null = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(answer);
  if (fence !== null) {
    answer = fence[1].trim();
  }
  const refusal: RegExpExecArray | null = /^NOT A SKILL:\s*(.*)$/im.exec(answer);
  if (refusal !== null && !answer.startsWith('---')) {
    return {
      kind: 'not-a-skill',
      reason: refusal[1].trim() || 'The AI judged it not to be a skill.',
    };
  }
  const start: number = answer.indexOf('---');
  if (start < 0) {
    return { kind: 'error', reason: 'The AI did not answer with a SKILL.md.' };
  }
  const parsed: ParsedSkillFile = parseSkillFile(answer.slice(start));
  const body: string = parsed.body.replace(/^\n+/, '');
  if (body.trim().length === 0) {
    return { kind: 'error', reason: 'The AI answered with an empty skill.' };
  }
  const description: string = clip(parsed.description || fallback.description);
  if (description.length === 0) {
    return { kind: 'error', reason: 'The AI did not write a description.' };
  }
  const tags: readonly string[] = [...parsed.scope.languages, ...parsed.technologies].filter(
    (id: string): boolean => OFFERED_TAGS.has(id),
  );
  const split: { languages: readonly string[]; technologies: readonly string[] } = splitSkillTags(
    tags,
    [],
    [],
  );
  return {
    kind: 'draft',
    draft: {
      name:
        parsed.name !== null && SKILL_NAME_PATTERN.test(parsed.name) ? parsed.name : fallback.name,
      description,
      scope: { surfaces: fallback.scope.surfaces, languages: split.languages },
      technologies: split.technologies,
      enabled: fallback.enabled,
      body,
    },
  };
}

/**
 * Keeps a description within the limit, cutting at a word.
 * @param text The description.
 * @returns Returns it, shortened when needed.
 */
function clip(text: string): string {
  const trimmed: string = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= SKILL_DESCRIPTION_LIMIT) {
    return trimmed;
  }
  const head: string = trimmed.slice(0, SKILL_DESCRIPTION_LIMIT - 1);
  const word: number = head.lastIndexOf(' ');
  return `${head.slice(0, word > 0 ? word : head.length)}…`;
}
