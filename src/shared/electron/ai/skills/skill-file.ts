import { readPromptScope, type PromptScope } from '@shared/api/ai-types';
import { SKILL_DESCRIPTION_LIMIT, SKILL_NAME_PATTERN } from '@shared/api/skill-channels';

// Reads and writes `SKILL.md`: YAML frontmatter between `---` fences, then a Markdown body. Only the
// subset of YAML a skill file needs is understood — scalars, inline `[a, b]` lists and block `- item`
// lists — because pulling a YAML library into the main bundle for four keys is not worth its weight,
// and a file that uses more than this subset still round-trips: keys this module does not own are
// kept as the lines they arrived as and written back unchanged.

/**
 * The frontmatter keys this module owns and rewrites on save. Everything else is preserved verbatim.
 */
const OWNED_KEYS: readonly string[] = ['name', 'description', 'surfaces', 'languages', 'enabled'];

/**
 * A parsed skill file.
 */
export interface ParsedSkillFile {
  /**
   * Gets the skill's name, or null when the frontmatter has none.
   */
  readonly name: string | null;

  /**
   * Gets the description, or empty when the frontmatter has none.
   */
  readonly description: string;

  /**
   * Gets the scope read from the `surfaces` and `languages` keys.
   */
  readonly scope: PromptScope;

  /**
   * Gets whether the skill is enabled; absent reads as enabled, so a file written by another tool is
   * offered rather than silently parked.
   */
  readonly enabled: boolean;

  /**
   * Gets the Markdown body, with the fences and frontmatter removed.
   */
  readonly body: string;

  /**
   * Gets the frontmatter lines belonging to keys this module does not own, in their original order,
   * so a save writes them back as they were.
   */
  readonly foreignLines: readonly string[];
}

/**
 * What a save writes.
 */
export interface SkillFileContent {
  /**
   * Gets the name written to the frontmatter.
   */
  readonly name: string;

  /**
   * Gets the description.
   */
  readonly description: string;

  /**
   * Gets the scope, written as the `surfaces` and `languages` keys.
   */
  readonly scope: PromptScope;

  /**
   * Gets whether the skill is enabled.
   */
  readonly enabled: boolean;

  /**
   * Gets the Markdown body.
   */
  readonly body: string;

  /**
   * Gets the frontmatter lines of keys this module does not own, written back after its own.
   */
  readonly foreignLines: readonly string[];
}

/**
 * Splits a file into its frontmatter lines and body. A file with no opening fence is all body.
 * @param text The file text.
 * @returns Returns the frontmatter lines and the body.
 */
function split(text: string): { readonly frontmatter: readonly string[]; readonly body: string } {
  const normalised: string = text.replace(/\r\n?/g, '\n');
  if (!normalised.startsWith('---\n') && normalised !== '---') {
    return { frontmatter: [], body: normalised };
  }
  // The closing fence is `---` on a line of its own — not `----`, not `--- title`.
  const closing: RegExpExecArray | null = /\n---(?:\n|$)/.exec(normalised.slice(3));
  if (closing === null) {
    return { frontmatter: [], body: normalised };
  }
  const fenceStart: number = closing.index + 3;
  const frontmatter: readonly string[] = normalised.slice(4, fenceStart).split('\n');
  return { frontmatter, body: normalised.slice(fenceStart + closing[0].length) };
}

/**
 * Reads a YAML scalar: unquotes a quoted string, otherwise returns the trimmed text.
 * @param raw The scalar text.
 * @returns Returns the value.
 */
function scalar(raw: string): string {
  const trimmed: string = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return String(JSON.parse(trimmed));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/**
 * Reads an inline `[a, b]` list.
 * @param raw The list text including the brackets.
 * @returns Returns the items.
 */
function inlineList(raw: string): string[] {
  const inner: string = raw.trim().slice(1, -1);
  return inner
    .split(',')
    .map(scalar)
    .filter((item: string): boolean => item.length > 0);
}

/**
 * Parses the frontmatter lines into owned values and foreign lines.
 * @param lines The frontmatter lines.
 * @returns Returns the owned values by key and the foreign lines.
 */
function parseFrontmatter(lines: readonly string[]): {
  readonly values: ReadonlyMap<string, string | readonly string[]>;
  readonly foreignLines: readonly string[];
} {
  const values: Map<string, string | readonly string[]> = new Map<
    string,
    string | readonly string[]
  >();
  const foreignLines: string[] = [];
  let index: number = 0;
  while (index < lines.length) {
    const line: string = lines[index];
    const match: RegExpMatchArray | null = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (match === null) {
      // A continuation, comment or blank we did not consume belongs to whatever came before; keep it.
      foreignLines.push(line);
      index += 1;
      continue;
    }
    const key: string = match[1];
    const rest: string = match[2];
    // A block list: the value is empty and the following lines are `- item`.
    const items: string[] = [];
    let consumed: number = index + 1;
    if (rest.trim().length === 0) {
      while (consumed < lines.length && /^\s+-\s*/.test(lines[consumed])) {
        items.push(scalar(lines[consumed].replace(/^\s+-\s*/, '')));
        consumed += 1;
      }
    }
    if (!OWNED_KEYS.includes(key)) {
      foreignLines.push(...lines.slice(index, consumed));
      index = consumed;
      continue;
    }
    if (rest.trim().startsWith('[')) {
      values.set(key, inlineList(rest));
    } else if (items.length > 0 || rest.trim().length === 0) {
      values.set(key, items);
    } else {
      values.set(key, scalar(rest));
    }
    index = consumed;
  }
  return { values, foreignLines };
}

/**
 * Parses a `SKILL.md`.
 * @param text The file text.
 * @returns Returns the parsed file.
 */
export function parseSkillFile(text: string): ParsedSkillFile {
  const { frontmatter, body } = split(text);
  const { values, foreignLines } = parseFrontmatter(frontmatter);
  const name: string | readonly string[] | undefined = values.get('name');
  const description: string | readonly string[] | undefined = values.get('description');
  const enabled: string | readonly string[] | undefined = values.get('enabled');
  const asList: (value: string | readonly string[] | undefined) => readonly string[] = (
    value: string | readonly string[] | undefined,
  ): readonly string[] => (value === undefined ? [] : typeof value === 'string' ? [value] : value);
  return {
    name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : null,
    description: typeof description === 'string' ? description.trim() : '',
    scope: readPromptScope({
      surfaces: asList(values.get('surfaces')),
      languages: asList(values.get('languages')),
    }),
    enabled: !(typeof enabled === 'string' && enabled.trim().toLowerCase() === 'false'),
    body,
    foreignLines,
  };
}

/**
 * Writes a YAML block list, or `[]` for an empty one so the key still reads as a list.
 * @param key The key.
 * @param items The items.
 * @returns Returns the lines.
 */
function listLines(key: string, items: readonly string[]): string[] {
  return items.length === 0
    ? [`${key}: []`]
    : [`${key}:`, ...items.map((item: string): string => `  - ${item}`)];
}

/**
 * Serialises a skill file. The description is always double-quoted (a JSON string is a valid YAML
 * one), so a colon or a hash in it cannot break the file a later reader parses.
 * @param content What to write.
 * @returns Returns the file text.
 */
export function serializeSkillFile(content: SkillFileContent): string {
  const lines: string[] = [
    '---',
    `name: ${content.name}`,
    `description: ${JSON.stringify(content.description)}`,
    ...listLines('surfaces', content.scope.surfaces),
    ...listLines('languages', content.scope.languages),
    `enabled: ${content.enabled ? 'true' : 'false'}`,
    ...content.foreignLines,
    '---',
    '',
  ];
  const body: string = content.body.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  return `${lines.join('\n')}${body}\n`;
}

/**
 * Says what is wrong with a skill's name and description, or nothing.
 * @param name The name.
 * @param description The description.
 * @returns Returns the problem, or null when both are acceptable.
 */
export function skillProblem(name: string | null, description: string): string | null {
  if (name === null) {
    return 'The frontmatter has no name.';
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    return 'The name may only use lower-case letters, digits and hyphens.';
  }
  if (description.length === 0) {
    return 'The frontmatter has no description, so a model cannot tell when to use it.';
  }
  if (description.length > SKILL_DESCRIPTION_LIMIT) {
    return `The description is longer than ${SKILL_DESCRIPTION_LIMIT} characters.`;
  }
  return null;
}
