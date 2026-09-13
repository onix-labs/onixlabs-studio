import { LOAD_SKILL } from '@shared/api/ai-types';
import type { AgentRunContext, OfferedSkill } from './agent-provider';

// The user-owned layers of a run's prompts (#300, #301), composed here so both are applied in exactly
// one place on each side of the wire: the system layer goes into the instructions core sends a
// harness with its tools, the user layer into the prompt field of the turn envelope. Neither is a new
// protocol field — a harness receives them inside strings it already reads — which is what lets every
// published harness honour them without a release.

/**
 * The heading that introduces the user's standing system text. Phrased so the model reads what
 * follows as the user's own instruction rather than as more of Studio's, because it is: the two are
 * appended in that order, and a model told which voice it is hearing weighs it correctly.
 */
const SYSTEM_EXTRA_HEADING: string =
  'The user has configured standing instructions for this context. Follow them alongside the above:';

/**
 * The separator and heading placed between the user's message and their standing instructions.
 * A rule rather than a blank line, because the two arrive as one string and the model has to be able
 * to see where the message the user typed ends.
 */
const USER_EXTRA_HEADING: string =
  '---\nStanding instructions the user has set for this kind of work, which apply to the message above:';

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
 * Composes the prompt a harness receives from the message the user typed and their standing
 * instructions for the run.
 *
 * 🔑 Beneath the message, not above it. The message is what the user is asking for; the standing text
 * is how they want it done, and a model reads the last thing in a prompt as the thing to satisfy — so
 * the standing text sits where it shapes the answer without displacing the ask.
 * @param context The run context.
 * @returns Returns the prompt, or the user's message unchanged when there are no standing instructions.
 */
export function composeUserPrompt(context: AgentRunContext): string {
  const extra: string = context.userPromptExtra.trim();
  return extra.length === 0
    ? context.prompt
    : `${context.prompt}\n\n${USER_EXTRA_HEADING}\n\n${extra}`;
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
