import { readPromptScope } from './ai/ai-prompt-scope';
import type { PromptProfile } from './prompt-profile-channels';
import { listLines, parseFrontmatter, splitFrontmatter } from './skill-file';

// Reads and writes a prompt profile's Markdown file (#1263): `name`, `surfaces`, `languages` and
// `enabled` in the frontmatter, the instructions as the body — the shape a skill has, so the two
// libraries read alike on disk. The id is the file name, not a key, so renaming the file is the one
// way to change it. Keys this module does not own are dropped on save: a profile has no other tool
// writing it, unlike a skill.

/**
 * The frontmatter keys a profile file carries.
 */
const PROFILE_KEYS: readonly string[] = ['name', 'surfaces', 'languages', 'enabled'];

/**
 * Parses a profile file.
 * @param id The profile's id: its file name without `.md`.
 * @param text The file text.
 * @returns Returns the profile; a missing name reads as the id, so a file written by hand still lists.
 */
export function parseProfileFile(id: string, text: string): PromptProfile {
  const { frontmatter, body } = splitFrontmatter(text);
  const { values } = parseFrontmatter(frontmatter, PROFILE_KEYS);
  const asList: (key: string) => readonly string[] = (key: string): readonly string[] => {
    const value: string | readonly string[] | undefined = values.get(key);
    return value === undefined ? [] : typeof value === 'string' ? [value] : value;
  };
  const name: string | readonly string[] | undefined = values.get('name');
  const enabled: string | readonly string[] | undefined = values.get('enabled');
  return {
    id,
    name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : id,
    scope: readPromptScope({ surfaces: asList('surfaces'), languages: asList('languages') }),
    instructions: body.replace(/^\n+/, '').replace(/\s+$/, ''),
    enabled: !(typeof enabled === 'string' && enabled.trim().toLowerCase() === 'false'),
  };
}

/**
 * Serialises a profile file. The name is always double-quoted (a JSON string is a valid YAML one), so
 * a colon or a hash in it cannot break the file.
 * @param profile The profile.
 * @returns Returns the file text.
 */
export function serializeProfileFile(profile: PromptProfile): string {
  const lines: string[] = [
    '---',
    `name: ${JSON.stringify(profile.name)}`,
    ...listLines('surfaces', profile.scope.surfaces),
    ...listLines('languages', profile.scope.languages),
    `enabled: ${profile.enabled ? 'true' : 'false'}`,
    '---',
    '',
  ];
  const body: string = profile.instructions.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  return `${lines.join('\n')}${body}\n`;
}
