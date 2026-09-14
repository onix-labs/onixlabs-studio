import type { ToolSet } from 'ai';
import { LOAD_SKILL } from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
import type { AgentRunContext, OfferedSkill } from './agent-provider';

/**
 * Loads a skill the model asked for, formatted for the model.
 * @param context The run context.
 * @param name The skill's name.
 * @returns Returns the instructions, or a sentence saying why there are none.
 */
async function loadSkill(context: AgentRunContext, name: string): Promise<string> {
  const wanted: string = name.trim().toLowerCase();
  const skill: OfferedSkill | undefined = context.skills.find(
    (candidate: OfferedSkill): boolean => candidate.name === wanted,
  );
  if (skill === undefined) {
    logger.debug('skill-tools.loadSkill', `Model asked for a skill not in scope: "${name}"`);
    return `There is no skill named "${name}" available here. The skills you may load are: ${context.skills
      .map((candidate: OfferedSkill): string => candidate.name)
      .join(', ')}.`;
  }
  const content: { readonly body: string; readonly files: readonly string[] } | null =
    await skill.load();
  if (content === null) {
    logger.warn('skill-tools.loadSkill', `Skill "${name}" vanished between listing and loading`);
    return `The skill "${name}" is no longer in the user's library.`;
  }
  logger.info('skill-tools.loadSkill', `Skill "${name}" loaded (${content.body.length} chars)`);
  const sections: string[] = [`# Skill: ${skill.name}`, content.body.trim()];
  if (content.files.length > 0) {
    sections.push(
      'This skill bundles the following files. Read them with your file tools if the instructions ' +
        `refer to them:\n${content.files.map((file: string): string => `- ${file}`).join('\n')}`,
    );
  }
  return sections.join('\n\n');
}

/**
 * Builds the skill tool for a run (#301): one tool, `load_skill`, present only when at least one skill
 * is in scope — a tool the model can never usefully call is better absent than described. Read-only,
 * so it is not gated: loading instructions the user wrote for exactly this purpose is not an action
 * to ask about.
 * @param context The run context.
 * @returns Returns the tool set, empty when no skill applies.
 */
export async function createSkillTools(context: AgentRunContext): Promise<ToolSet> {
  if (context.skills.length === 0) {
    return {};
  }
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    [LOAD_SKILL]: tool({
      description:
        "Load one of the user's skills — a named set of standing instructions for a kind of work — and receive its full text. Call it before starting a task that matches a skill's description, then follow what it says.",
      inputSchema: z.object({
        name: z.string().min(1).describe('The name of the skill, exactly as listed.'),
      }),
      execute: (args: { name: string }): Promise<string> => loadSkill(context, args.name),
    }),
  };
}
