import type { Skill } from '@shared/api/skill-channels';

/**
 * Describes the project Studio made before the conversation, for the first message.
 */
export interface MadeProject {
  /**
   * Gets its name.
   */
  readonly name: string;

  /**
   * Gets where it is.
   */
  readonly path: string;

  /**
   * Gets its repository in a phrase — "a local repository" — or null for none.
   */
  readonly repository: string | null;
}

/**
 * Describes everything the New Project wizard gathered, as plain values: what the first message is
 * written from (#806).
 */
export interface ProjectMessageInput {
  /**
   * Gets what is being built: a template's goal ("a desktop application"), the user's own words, or
   * null when the Start step was skipped.
   */
  readonly goal: { readonly kind: 'template' | 'idea'; readonly text: string } | null;

  /**
   * Gets the project Studio made, or null when the conversation starts before there is one.
   */
  readonly made: MadeProject | null;

  /**
   * Gets the name the user gave without a place to make it, or null.
   */
  readonly name: string | null;

  /**
   * Gets the user's summary of the project, or empty.
   */
  readonly summary: string;

  /**
   * Gets the technologies chosen, by category, each category's label with its names.
   */
  readonly technologies: readonly {
    readonly category: string;
    readonly names: readonly string[];
  }[];

  /**
   * Gets the options answered, each its name and its answer: "Containers", "run it in containers".
   */
  readonly options: readonly { readonly label: string; readonly phrase: string }[];

  /**
   * Gets the names of the skills the user asked the agent to follow.
   */
  readonly skills: readonly string[];

  /**
   * Gets the names of the supporting documents attached.
   */
  readonly documents: readonly string[];
}

/**
 * Writes the first message of a new project's conversation from what the wizard gathered (#806): in
 * the user's voice, what they want to build and what is already decided, so the agent starts from all
 * of it at once. A section with nothing in it is left out, so a skipped step leaves no trace.
 * @param input What the wizard gathered.
 * @returns Returns the message, as Markdown.
 */
export function projectMessage(input: ProjectMessageInput): string {
  const opening: string[] = [
    input.goal === null
      ? 'I want to build something new.'
      : input.goal.kind === 'template'
        ? `I want to build ${input.goal.text}.`
        : `I want to build this: ${input.goal.text.trim()}`,
  ];
  if (input.made !== null) {
    opening.push(
      `I've created a project for it called "${input.made.name}", at ${input.made.path}${input.made.repository === null ? '' : `, with ${input.made.repository}`}.`,
    );
  } else if (input.name !== null) {
    opening.push(`I'd like to call it "${input.name}".`);
  }
  const sections: string[] = [opening.join(' ')];
  if (input.summary.trim().length > 0) {
    sections.push(`**About it**\n\n${input.summary.trim()}`);
  }
  if (input.technologies.length > 0) {
    sections.push(
      `**Technology**\n\n${input.technologies
        .map((group): string => `- ${group.category}: ${group.names.join(', ')}`)
        .join('\n')}`,
    );
  }
  const preferences: string[] = [
    ...input.options.map((option): string => `- ${option.label}: ${option.phrase}`),
    ...(input.skills.length === 0 ? [] : [`- Skills to follow: ${input.skills.join(', ')}`]),
  ];
  if (preferences.length > 0) {
    sections.push(`**Preferences**\n\n${preferences.join('\n')}`);
  }
  if (input.documents.length > 0) {
    sections.push(
      `**Supporting documents** (attached)\n\n${input.documents.map((name: string): string => `- ${name}`).join('\n')}`,
    );
  }
  sections.push('Help me plan it before we build anything.');
  return sections.join('\n\n');
}

/**
 * Writes the brief every turn of a new project's conversation carries: how to work with the user, and
 * the skills to follow — the template's, then any the user chose — when the library has them.
 * @param hasFolder Whether the project already has a folder, which the conversation runs in.
 * @param skills The skills to follow.
 * @returns Returns the brief.
 */
export function projectBrief(hasFolder: boolean, skills: readonly Skill[]): string {
  return [
    hasFolder
      ? 'This conversation starts a new project, in its new workspace. It holds nothing the user wrote yet.'
      : 'This conversation starts a new project that has no folder yet, so there is nowhere to create files: do not try to. When the plan is settled, say so; the user chooses where the project goes.',
    'Help the user plan the project before building it. Build on what they have already decided rather than asking it again; ask about what is missing one question at a time, and recommend an option when offering a choice. Follow them if they want to talk about something else. Ask before creating files.',
    ...skills.map((skill: Skill): string => `Follow the "${skill.name}" skill:\n\n${skill.body}`),
  ].join('\n\n');
}
