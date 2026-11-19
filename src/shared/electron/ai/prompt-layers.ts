import { FORGET_PERSONA, LOAD_SKILL, SEARCH_PERSONA } from '@shared/api/ai-types';
import type { AgentRunContext, OfferedSkill, PersonaAccess } from './agent-provider';

// The user-owned layers of a run's instructions (#300, #301), composed here so they are applied in
// exactly one place: the instructions core sends a harness with its tools. Neither is a new protocol
// field — a harness receives them inside a string it already reads — which is what lets every
// published harness honour them without a release.

/**
 * The heading that introduces the user's standing system text. Phrased so the model reads what
 * follows as the user's own instruction rather than as more of Studio's, because it is: the two are
 * appended in that order, and a model told which voice it is hearing weighs it correctly.
 *
 * The second sentence is there because the text can change mid-conversation (#955). A model handed
 * new instructions reads them as if they had always applied, sees its earlier replies did not follow
 * them, and apologises for "missing" them; told they may have changed, it just applies them from here.
 * It is fixed wording, so it never disturbs a cached prompt prefix.
 */
const SYSTEM_EXTRA_HEADING: string =
  'The user has configured standing instructions for this context. Follow them alongside the above. ' +
  'The user may change them during a conversation: follow them as they read now, from your next ' +
  'reply on, and do not comment on whether earlier replies followed them:';

/**
 * Appends the user's standing system text to Studio's instructions.
 *
 * ⛔ Append-only. The user's text can add guidance — a coding style, a house tone, a nudge for a
 * weaker model — but it never replaces the surface's own instructions, because those describe the
 * tools the model is holding and an edit that dropped them would strand the model with capabilities
 * it was never told about.
 * @param instructions Studio's own instructions for the surface and mode.
 * @param context The run context.
 * @returns Returns the instructions with the user's layer beneath, or unchanged when there is none.
 */
export function withSystemPromptExtra(instructions: string, context: AgentRunContext): string {
  const extra: string = context.systemPromptExtra.trim();
  return extra.length === 0
    ? instructions
    : `${instructions}\n\n${SYSTEM_EXTRA_HEADING}\n\n${extra}`;
}

/**
 * Describes the skills in scope for a run, for the system prompt: each one's name and description,
 * and how to load one. The listing is the always-visible half of progressive disclosure — it costs
 * a line per skill on every turn so the body, which may be long, costs nothing until it is wanted.
 * @param context The run context.
 * @returns Returns the appendix, or an empty string when no skill is in scope.
 */
export function skillsAppendix(context: AgentRunContext): string {
  if (context.skills.length === 0) {
    return '';
  }
  const lines: string[] = context.skills.map(
    (skill: OfferedSkill): string => `- ${skill.name}: ${skill.description}`,
  );
  return [
    'The user keeps a library of skills: named sets of instructions for particular kinds of work.',
    'These apply here:',
    ...lines,
    `When a task matches a skill's description, call "${LOAD_SKILL}" with its name BEFORE starting the`,
    'work and follow the instructions it returns. Load a skill once per conversation; do not load one',
    'whose description does not fit the task.',
  ].join('\n');
}

/**
 * Tells the agent about the user's persona and how to use it (#1515): that it can search the memories
 * Studio keeps about the user, when to, what tags there are, and the rules that keep it honest — say
 * when it is acting on the persona, so a one-word correction can put it right, and never treat a
 * preference as a permission. Fixed wording apart from the tag list, which changes rarely, so the
 * cached prompt prefix survives from turn to turn.
 * @param context The run context.
 * @returns Returns the appendix, or an empty string when there is no memory to search.
 */
export function personaAppendix(context: AgentRunContext): string {
  const persona: PersonaAccess | null | undefined = context.persona;
  if (persona === null || persona === undefined || persona.memories === 0) {
    return '';
  }
  const lines: string[] = [
    'Studio keeps a persona of the user: things they have told agents before about how they like to',
    `work and decide. Search its memories with "${SEARCH_PERSONA}" when the conversation starts, when`,
    'the topic changes, and BEFORE asking the user a question, since the answer may already be there.',
    'Search by the kind of preference or decision as well as the subject: how they like to choose a',
    'database also tells you how they like to choose a laptop.',
  ];
  if (persona.tags.length > 0) {
    lines.push(`Its tags: ${persona.tags.join(', ')}.`);
  }
  lines.push(
    'When you act on something you found there, say so in a few words ("Going with one recommendation,',
    'since that\'s how you like it"), so the user can correct you.',
    'The persona holds preferences, never permissions. Anything that publishes, deletes, spends or',
    'cannot be undone is still confirmed with the user every time, whatever the persona says.',
  );
  if (context.mode !== 'chat') {
    lines.push(
      `If the user asks you to forget something, or not to remember it, call "${FORGET_PERSONA}" with`,
      'the ids a search returned.',
    );
  }
  return lines.join('\n');
}
