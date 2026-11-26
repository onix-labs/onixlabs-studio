import { readPromptScope } from './ai/ai-prompt-scope';
import {
  clampConfidence,
  normalizeTags,
  PERSONA_ENTRY_ID_PATTERN,
  PERSONA_LIST_LIMIT,
  type PersonaAuthor,
  type PersonaEntry,
  type PersonaLayer,
} from './persona-channels';
import { listLines, parseFrontmatter, splitFrontmatter } from './skill-file';

// Reads and writes a persona entry's Markdown file (#1514): the entry's facts in the frontmatter, its
// text as the body — the shape a prompt profile and a skill have, so the libraries read alike on disk.
//
// 🔑 A prompt profile's file is a valid entry file. The keys a profile has (`name`, `surfaces`,
// `languages`, `enabled`) mean the same here, and every key it lacks defaults to what a converted
// profile is: in the core, written by the user, locked. So converting a profile is reading its file
// and writing it back, and a profile file dropped into the persona folder by hand just works.

/**
 * The frontmatter keys an entry file carries.
 */
const ENTRY_KEYS: readonly string[] = [
  'name',
  'layer',
  'surfaces',
  'languages',
  'tags',
  'links',
  'why',
  'confidence',
  'confirmed',
  'author',
  'locked',
  'enabled',
];

/**
 * Parses an entry file.
 * @param id The entry's id: its file name without `.md`.
 * @param text The file text.
 * @returns Returns the entry; a missing name reads as the id, so a file written by hand still lists.
 */
export function parseEntryFile(id: string, text: string): PersonaEntry {
  const { frontmatter, body } = splitFrontmatter(text);
  const { values } = parseFrontmatter(frontmatter, ENTRY_KEYS);
  const asList: (key: string) => readonly string[] = (key: string): readonly string[] => {
    const value: string | readonly string[] | undefined = values.get(key);
    return value === undefined ? [] : typeof value === 'string' ? [value] : value;
  };
  const asText: (key: string) => string = (key: string): string => {
    const value: string | readonly string[] | undefined = values.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };
  const author: PersonaAuthor = asText('author').toLowerCase() === 'learned' ? 'learned' : 'user';
  const locked: string = asText('locked').toLowerCase();
  const confidence: number = Number.parseFloat(asText('confidence'));
  return {
    id,
    name: asText('name') || id,
    text: body.replace(/^\n+/, '').replace(/\s+$/, ''),
    why: asText('why'),
    tags: normalizeTags(asList('tags')),
    links: asList('links')
      .map((link: string): string => link.trim())
      .filter((link: string): boolean => PERSONA_ENTRY_ID_PATTERN.test(link) && link !== id)
      .slice(0, PERSONA_LIST_LIMIT),
    scope: readPromptScope({ surfaces: asList('surfaces'), languages: asList('languages') }),
    layer: readLayer(asText('layer')),
    enabled: asText('enabled').toLowerCase() !== 'false',
    // What the user wrote is certain; learned entries say how sure learning is.
    confidence: Number.isNaN(confidence) ? 1 : clampConfidence(confidence),
    confirmed: /^\d{4}-\d{2}-\d{2}$/.test(asText('confirmed')) ? asText('confirmed') : '',
    author,
    // An entry the user wrote is locked unless they unlocked it; one learning wrote, unless they locked it.
    locked: locked === '' ? author === 'user' : locked === 'true',
  };
}

/**
 * Serialises an entry file. Free text is always double-quoted (a JSON string is a valid YAML one), so a
 * colon or a hash in it cannot break the file.
 * @param entry The entry.
 * @returns Returns the file text.
 */
export function serializeEntryFile(entry: PersonaEntry): string {
  const lines: string[] = [
    '---',
    `name: ${JSON.stringify(entry.name)}`,
    `layer: ${entry.layer}`,
    ...listLines('surfaces', entry.scope.surfaces),
    ...listLines('languages', entry.scope.languages),
    ...listLines(
      'tags',
      entry.tags.map((tag: string): string => JSON.stringify(tag)),
    ),
    ...listLines('links', entry.links),
    ...(entry.why.trim().length > 0 ? [`why: ${JSON.stringify(entry.why.trim())}`] : []),
    `confidence: ${String(Math.round(clampConfidence(entry.confidence) * 100) / 100)}`,
    ...(entry.confirmed.length > 0 ? [`confirmed: ${entry.confirmed}`] : []),
    `author: ${entry.author}`,
    `locked: ${entry.locked ? 'true' : 'false'}`,
    `enabled: ${entry.enabled ? 'true' : 'false'}`,
    '---',
    '',
  ];
  const body: string = entry.text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  return `${lines.join('\n')}${body}\n`;
}

/**
 * Reads a layer, defaulting to the core: a file with no layer is a prompt profile's.
 * @param value The value written.
 * @returns Returns the layer.
 */
function readLayer(value: string): PersonaLayer {
  return value.toLowerCase() === 'memory' ? 'memory' : 'core';
}
