import { promises as fs, Dirent, Stats } from 'node:fs';
import { basename, dirname, join, posix, relative, sep } from 'node:path';
import { GLOBAL_SCOPE } from '@shared/api/ai-types';
import { profileIdFor, slugify } from '@shared/api/prompt-profile-channels';
import { parseProfileFile } from '@shared/api/prompt-profile-file';
import type { PromptProfile } from '@shared/api/prompt-profile-channels';
import {
  SKILL_DESCRIPTION_TARGET,
  SKILL_FILE,
  SKILL_NAME_PATTERN,
} from '@shared/api/skill-channels';
import { parseSkillFile, skillProblem, type ParsedSkillFile } from '@shared/api/skill-file';
import {
  LIBRARY_EXPORT_FORMAT,
  type SkillImportDraft,
  type SkillImportEntry,
  type SkillImportKind,
  type SkillImportStatus,
} from '@shared/api/skill-import-channels';

// Reads a folder someone chose to import from (#1263) and drafts every candidate in it, without
// writing anything — the source is the user's, and treated as read-only throughout. Two shapes are
// recognised: Studio's own (an export, or a folder of `SKILL.md` folders), which comes back as it is,
// and anything else, where every Markdown file is a candidate whose name and description are drafted
// from its file name, its heading, its introduction and its "When to use" section.

/**
 * Folders never searched: version control, dependencies and tool state, none of which hold skills.
 */
const SKIPPED_FOLDERS: readonly string[] = ['node_modules', 'bower_components', '__pycache__'];

/**
 * File names (without extension, lower-cased) that are repository furniture rather than skills.
 */
const REPOSITORY_FILES: readonly string[] = [
  'readme',
  'license',
  'licence',
  'changelog',
  'changes',
  'history',
  'contributing',
  'code_of_conduct',
  'code-of-conduct',
  'authors',
  'contributors',
  'notice',
  'index',
  'toc',
  'summary',
  'pull_request_template',
  'issue_template',
];

/**
 * File names that hold an agent's standing instructions for a repository — a different thing from a
 * skill, and imported as one only if the user says so.
 */
const AGENT_INSTRUCTION_FILES: readonly string[] = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

/**
 * The fewest characters of prose a file needs to stand as a skill on its own.
 */
const MINIMUM_BODY: number = 200;

/**
 * The most Markdown files one scan reads, so pointing the import at a home folder cannot hang it.
 */
const FILE_LIMIT: number = 2_000;

/**
 * The largest file read as a candidate; anything bigger is listed as needing a person's look.
 */
const FILE_SIZE_LIMIT: number = 256 * 1024;

/**
 * What a scan found, before the plan is given an id.
 */
export interface ScannedFolder {
  /**
   * Gets how the plan treats what it found.
   */
  readonly kind: SkillImportKind;

  /**
   * Gets the skill candidates, in path order.
   */
  readonly entries: readonly ScannedEntry[];

  /**
   * Gets the profiles found in an export.
   */
  readonly profiles: readonly PromptProfile[];

  /**
   * Gets whether the scan stopped at {@link FILE_LIMIT}.
   */
  readonly truncated: boolean;
}

/**
 * A candidate together with where it lives, which only the main process knows.
 */
export interface ScannedEntry extends SkillImportEntry {
  /**
   * Gets the absolute path of the folder whose other files come with the skill, or null for a lone
   * Markdown file.
   */
  readonly folder: string | null;
}

/**
 * Scans a chosen folder or file.
 * @param path The absolute path chosen.
 * @returns Returns what was found; the root the entries' sources are relative to is the folder chosen,
 * or the chosen file's folder.
 */
export async function scanForSkills(path: string): Promise<ScannedFolder> {
  const stat: Stats = await fs.stat(path);
  if (stat.isFile()) {
    const root: string = dirname(path);
    if (basename(path) === SKILL_FILE) {
      const entry: ScannedEntry | null = await readSkillFolder(dirname(root), basename(root));
      return {
        kind: 'restore',
        entries: entry === null ? [] : [entry],
        profiles: [],
        truncated: false,
      };
    }
    const entry: ScannedEntry = await readMarkdown(root, path);
    return { kind: 'convert', entries: [entry], profiles: [], truncated: false };
  }
  if (await isExport(path)) {
    return {
      kind: 'restore',
      entries: await readSkillFolders(join(path, 'skills'), 'skills/'),
      profiles: await readProfiles(join(path, 'profiles')),
      truncated: false,
    };
  }
  if (await fileExists(join(path, SKILL_FILE))) {
    const entry: ScannedEntry | null = await readSkillFolder(dirname(path), basename(path));
    return {
      kind: 'restore',
      entries: entry === null ? [] : [entry],
      profiles: [],
      truncated: false,
    };
  }
  const folders: readonly ScannedEntry[] = await readSkillFolders(path, '');
  if (folders.length > 0) {
    return { kind: 'restore', entries: folders, profiles: [], truncated: false };
  }
  const { files, truncated } = await findMarkdown(path);
  const entries: ScannedEntry[] = [];
  for (const file of files) {
    entries.push(
      basename(file) === SKILL_FILE
        ? ((await readSkillFolder(dirname(dirname(file)), basename(dirname(file)), path)) ??
            (await readMarkdown(path, file)))
        : await readMarkdown(path, file),
    );
  }
  return { kind: 'convert', entries, profiles: [], truncated };
}

/**
 * Scans what the user picked: one file or folder as {@link scanForSkills} reads it, or several —
 * files, folders or a mix — as one conversion whose sources are relative to the folder they share,
 * so links between them still resolve. A picked folder holding a `SKILL.md` is one candidate; any
 * other picked folder is searched for Markdown.
 * @param paths The absolute paths picked.
 * @returns Returns what was found.
 */
export async function scanSelection(paths: readonly string[]): Promise<ScannedFolder> {
  if (paths.length === 1) {
    return scanForSkills(paths[0]);
  }
  const root: string = commonFolder(paths);
  const found: Map<string, ScannedEntry> = new Map<string, ScannedEntry>();
  let truncated: boolean = false;
  const add: (entry: ScannedEntry | null) => void = (entry: ScannedEntry | null): void => {
    if (entry !== null && !found.has(entry.source)) {
      found.set(entry.source, entry);
    }
  };
  const readFile: (file: string) => Promise<ScannedEntry> = async (
    file: string,
  ): Promise<ScannedEntry> =>
    basename(file) === SKILL_FILE
      ? ((await readSkillFolder(dirname(dirname(file)), basename(dirname(file)), root)) ??
        (await readMarkdown(root, file)))
      : readMarkdown(root, file);
  for (const path of paths) {
    const stat: Stats = await fs.stat(path);
    if (stat.isFile()) {
      add(await readFile(path));
    } else if (await fileExists(join(path, SKILL_FILE))) {
      add(await readFile(join(path, SKILL_FILE)));
    } else if (stat.isDirectory()) {
      const walked: { readonly files: readonly string[]; readonly truncated: boolean } =
        await findMarkdown(path);
      truncated ||= walked.truncated;
      for (const file of walked.files) {
        add(await readFile(file));
      }
    }
  }
  const entries: ScannedEntry[] = [...found.values()].sort(
    (a: ScannedEntry, b: ScannedEntry): number => a.source.localeCompare(b.source),
  );
  return { kind: 'convert', entries, profiles: [], truncated };
}

/**
 * Finds the deepest folder holding every path.
 * @param paths The absolute paths.
 * @returns Returns the folder.
 */
export function commonFolder(paths: readonly string[]): string {
  const split: readonly string[][] = paths.map((path: string): string[] =>
    dirname(path).split(sep),
  );
  const shared: string[] = [];
  for (let index: number = 0; index < split[0].length; index += 1) {
    const part: string = split[0][index];
    if (split.some((parts: string[]): boolean => parts[index] !== part)) {
      break;
    }
    shared.push(part);
  }
  return shared.join(sep) || sep;
}

/**
 * Scans what the user picked for prompt profiles (#1263): each Markdown file is one profile, named by
 * its frontmatter, else its title, else its file name; a Studio export contributes its profiles.
 * Repository files (a README, a licence) are passed over. Ids are made unique within the pick.
 * @param paths The absolute paths picked.
 * @returns Returns the profiles, in path order.
 */
export async function scanProfiles(paths: readonly string[]): Promise<readonly PromptProfile[]> {
  const files: string[] = [];
  const exported: PromptProfile[] = [];
  for (const path of paths) {
    const stat: Stats = await fs.stat(path);
    if (stat.isFile()) {
      files.push(path);
    } else if (await isExport(path)) {
      exported.push(...(await readProfiles(join(path, 'profiles'))));
    } else if (stat.isDirectory()) {
      files.push(...(await findMarkdown(path)).files);
    }
  }
  const taken: string[] = exported.map((profile: PromptProfile): string => profile.id);
  const profiles: PromptProfile[] = [...exported];
  for (const file of [...new Set(files)].sort()) {
    const stem: string = basename(file).replace(/\.(md|markdown)$/i, '');
    if (
      REPOSITORY_FILES.includes(stem.toLowerCase()) ||
      AGENT_INSTRUCTION_FILES.includes(basename(file))
    ) {
      continue;
    }
    const text: string = await fs.readFile(file, 'utf8');
    const parsed: PromptProfile = parseProfileFile(stem, text);
    const titled: string | null = parsed.name === stem ? titleOf(parsed.instructions) : null;
    const name: string = titled ?? parsed.name;
    if (parsed.instructions.trim().length === 0) {
      continue;
    }
    const id: string = profileIdFor(name, taken);
    taken.push(id);
    profiles.push({ ...parsed, id, name });
  }
  return profiles;
}

/**
 * Reads a Markdown body's first-level title.
 * @param body The body.
 * @returns Returns the title, or null when it has none.
 */
function titleOf(body: string): string | null {
  const heading: RegExpExecArray | null = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
  return heading === null ? null : heading[1];
}

/**
 * Determines whether a folder is a Studio export.
 * @param folder The folder.
 * @returns Returns true when its `manifest.json` names the export format.
 */
async function isExport(folder: string): Promise<boolean> {
  try {
    const manifest: unknown = JSON.parse(await fs.readFile(join(folder, 'manifest.json'), 'utf8'));
    return (
      manifest !== null &&
      typeof manifest === 'object' &&
      (manifest as Record<string, unknown>)['format'] === LIBRARY_EXPORT_FORMAT
    );
  } catch {
    return false;
  }
}

/**
 * Reads every immediate sub-folder that holds a `SKILL.md`.
 * @param folder The folder holding skill folders.
 * @param prefix The prefix their sources carry, relative to the chosen root.
 * @returns Returns the candidates, in name order.
 */
async function readSkillFolders(folder: string, prefix: string): Promise<readonly ScannedEntry[]> {
  let children: Dirent[];
  try {
    children = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries: ScannedEntry[] = [];
  for (const child of children.sort((a: Dirent, b: Dirent): number =>
    a.name.localeCompare(b.name),
  )) {
    if (!child.isDirectory() || child.name.startsWith('.')) {
      continue;
    }
    const entry: ScannedEntry | null = await readSkillFolder(folder, child.name, undefined, prefix);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Reads one `SKILL.md` folder as a candidate.
 * @param parent The folder holding it.
 * @param name The folder's name.
 * @param root The chosen root sources are relative to; defaults to the parent.
 * @param prefix A prefix for the source when the root is the parent.
 * @returns Returns the candidate, or null when the folder holds no readable `SKILL.md`.
 */
async function readSkillFolder(
  parent: string,
  name: string,
  root?: string,
  prefix: string = '',
): Promise<ScannedEntry | null> {
  const folder: string = join(parent, name);
  let text: string;
  try {
    text = await fs.readFile(join(folder, SKILL_FILE), 'utf8');
  } catch {
    return null;
  }
  const parsed: ParsedSkillFile = parseSkillFile(text);
  const draftName: string = SKILL_NAME_PATTERN.test(name) ? name : slugify(parsed.name ?? name);
  const description: string = parsed.description || draftDescription(parsed.body);
  const problem: string | null = skillProblem(draftName, description);
  const source: string =
    root === undefined
      ? `${prefix}${name}/${SKILL_FILE}`
      : toPosix(relative(root, join(folder, SKILL_FILE)));
  return {
    source,
    status: problem === null ? 'ready' : 'needs-ai',
    reason: problem,
    draft: {
      name: draftName,
      description,
      scope: parsed.scope,
      technologies: parsed.technologies,
      enabled: parsed.enabled,
      body: parsed.body,
    },
    bundled: await bundledFiles(folder),
    // A skill folder's links are relative to its own layout, which import keeps as it is.
    links: [],
    folder,
  };
}

/**
 * Reads one plain Markdown file as a candidate.
 * @param root The chosen root.
 * @param file The file's absolute path.
 * @returns Returns the candidate.
 */
async function readMarkdown(root: string, file: string): Promise<ScannedEntry> {
  const source: string = toPosix(relative(root, file));
  const stem: string = basename(file).replace(/\.(md|markdown)$/i, '');
  const empty: SkillImportDraft = {
    name: slugify(stem),
    description: '',
    scope: GLOBAL_SCOPE,
    technologies: [],
    enabled: true,
    body: '',
  };
  const size: number = (await fs.stat(file)).size;
  if (size > FILE_SIZE_LIMIT) {
    return entry(source, 'needs-ai', 'The file is too large to import as one skill.', empty);
  }
  const text: string = await fs.readFile(file, 'utf8');
  const parsed: ParsedSkillFile = parseSkillFile(text);
  const draft: SkillImportDraft = {
    name:
      parsed.name !== null && SKILL_NAME_PATTERN.test(parsed.name) ? parsed.name : slugify(stem),
    description: parsed.description || draftDescription(parsed.body),
    scope: parsed.scope,
    technologies: parsed.technologies,
    enabled: parsed.enabled,
    body: parsed.body,
  };
  const { status, reason } = classify(basename(file), parsed.body, draft);
  return entry(source, status, reason, draft);
}

/**
 * Builds a lone-file candidate.
 * @param source The source path.
 * @param status The status.
 * @param reason Why it is not ready, or null.
 * @param draft The draft.
 * @returns Returns the candidate.
 */
function entry(
  source: string,
  status: SkillImportStatus,
  reason: string | null,
  draft: SkillImportDraft,
): ScannedEntry {
  return {
    source,
    status,
    reason,
    draft,
    bundled: [],
    links: linkedFiles(draft.body, source),
    folder: null,
  };
}

/**
 * Decides whether a plain Markdown file can go straight in.
 * @param fileName The file's name.
 * @param body The file's body, frontmatter removed.
 * @param draft What was drafted from it.
 * @returns Returns the status and, when it is not ready, why.
 */
export function classify(
  fileName: string,
  body: string,
  draft: SkillImportDraft,
): { readonly status: SkillImportStatus; readonly reason: string | null } {
  const stem: string = fileName.replace(/\.(md|markdown)$/i, '');
  if (REPOSITORY_FILES.includes(stem.toLowerCase()) || stem === 'SECURITY') {
    return {
      status: 'not-a-skill',
      reason: `${fileName} looks like a repository file, not a skill.`,
    };
  }
  if (AGENT_INSTRUCTION_FILES.includes(fileName)) {
    return {
      status: 'not-a-skill',
      reason: `${fileName} holds an agent's standing instructions for a repository, not a skill.`,
    };
  }
  if (body.trim().length < MINIMUM_BODY) {
    return { status: 'needs-ai', reason: 'The file is too short to stand as a skill on its own.' };
  }
  if (draft.name.length === 0) {
    return { status: 'needs-ai', reason: 'No usable name could be made from the file name.' };
  }
  if (draft.description.length === 0) {
    return {
      status: 'needs-ai',
      reason: 'There is no introduction to draft a description from.',
    };
  }
  return { status: 'ready', reason: skillProblem(draft.name, draft.description) };
}

/**
 * Drafts a description from a Markdown body: the first sentence after the title, followed by as
 * many bullets of a "When to use" section as fit within {@link SKILL_DESCRIPTION_TARGET}; a first
 * sentence longer than that is shortened at a word.
 * @param body The Markdown body.
 * @returns Returns the description, or empty when there is no introduction to draft from.
 */
export function draftDescription(body: string): string {
  const lines: readonly string[] = body.replace(/\r\n?/g, '\n').split('\n');
  let index: number = lines.findIndex((line: string): boolean => /^#\s+\S/.test(line));
  index = index < 0 ? 0 : index + 1;
  const paragraph: string[] = [];
  for (; index < lines.length; index += 1) {
    const line: string = lines[index].trim();
    if (line.length === 0) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }
    if (/^(#|```|\||>|[-*+]\s|\d+\.\s|<)/.test(line)) {
      if (paragraph.length > 0) {
        break;
      }
      // A file that opens with a list, a table or code has no introduction to quote.
      if (!line.startsWith('#')) {
        break;
      }
      continue;
    }
    paragraph.push(line);
  }
  const intro: string = plainText(paragraph.join(' '));
  if (intro.length === 0) {
    return '';
  }
  const first: string = firstSentence(intro);
  if (first.length > SKILL_DESCRIPTION_TARGET) {
    return shorten(first, SKILL_DESCRIPTION_TARGET);
  }
  let description: string = first;
  const uses: string[] = whenToUse(lines);
  for (let count: number = 1; count <= uses.length; count += 1) {
    const candidate: string = `${first} Use it when: ${uses.slice(0, count).join('; ')}.`;
    if (candidate.length > SKILL_DESCRIPTION_TARGET) {
      break;
    }
    description = candidate;
  }
  return description;
}

/**
 * Reads the first sentence of a paragraph: up to the first full stop, question or exclamation mark
 * followed by a space and a capital, or the whole paragraph when there is none.
 * @param paragraph The paragraph.
 * @returns Returns the sentence.
 */
function firstSentence(paragraph: string): string {
  const end: RegExpExecArray | null = /[.!?](?=\s+[A-Z(“"'])/.exec(paragraph);
  return end === null ? paragraph : paragraph.slice(0, end.index + 1);
}

/**
 * Reads the bullets of a "When to use" section.
 * @param lines The body's lines.
 * @returns Returns the bullets as plain text, trailing punctuation removed.
 */
function whenToUse(lines: readonly string[]): string[] {
  const start: number = lines.findIndex((line: string): boolean =>
    /^#{2,3}\s+when\s+to\s+(use|apply)/i.test(line.trim()),
  );
  if (start < 0) {
    return [];
  }
  const bullets: string[] = [];
  for (let index: number = start + 1; index < lines.length; index += 1) {
    const line: string = lines[index];
    if (/^#{1,3}\s/.test(line)) {
      break;
    }
    const bullet: RegExpExecArray | null = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet !== null) {
      const text: string = plainText(bullet[1]).replace(/[.;:,]+$/, '');
      if (text.length > 0) {
        bullets.push(text.charAt(0).toLowerCase() + text.slice(1));
      }
    }
  }
  return bullets;
}

/**
 * Reduces inline Markdown to plain text: links to their text, emphasis markers removed.
 * @param text The Markdown text.
 * @returns Returns the plain text.
 */
function plainText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Shortens text to a limit at the last sentence end that fits, else at a word, with an ellipsis.
 * @param text The text.
 * @param limit The most characters.
 * @returns Returns the shortened text.
 */
function shorten(text: string, limit: number): string {
  const head: string = text.slice(0, limit);
  const sentence: number = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? '),
  );
  if (sentence > limit / 2) {
    return head.slice(0, sentence + 1);
  }
  const word: number = head.slice(0, limit - 1).lastIndexOf(' ');
  return `${head.slice(0, word > 0 ? word : limit - 1)}…`;
}

/**
 * Rewrites the relative links in an imported body that point at other files in the same import, so
 * they point at those files' new places in the library (`gdpr.md` → `../gdpr/SKILL.md`). Links to
 * anything else — the web, anchors, files that were not imported — are left as they are.
 * @param body The body.
 * @param source The body's source path, relative to the chosen root.
 * @param nameBySource The final skill name of every imported source.
 * @returns Returns the body and how many links were rewritten.
 */
export function rewriteSkillLinks(
  body: string,
  source: string,
  nameBySource: ReadonlyMap<string, string>,
): { readonly body: string; readonly rewritten: number } {
  let rewritten: number = 0;
  const body2: string = replaceLinkTargets(body, (target: string): string | null => {
    const resolved: { readonly path: string; readonly anchor: string } | null = resolveLink(
      target,
      source,
    );
    const name: string | undefined =
      resolved === null ? undefined : nameBySource.get(resolved.path);
    if (resolved === null || name === undefined) {
      return null;
    }
    rewritten += 1;
    return `../${name}/${SKILL_FILE}${resolved.anchor}`;
  });
  return { body: body2, rewritten };
}

/**
 * Lists the Markdown files a body links to by relative path, resolved against the chosen root, so
 * the summary can say which links will point nowhere once imported.
 * @param body The body.
 * @param source The body's source path, relative to the chosen root.
 * @returns Returns the linked paths, each once, in the order first linked.
 */
export function linkedFiles(body: string, source: string): readonly string[] {
  const found: Set<string> = new Set<string>();
  replaceLinkTargets(body, (target: string): null => {
    const resolved: { readonly path: string } | null = resolveLink(target, source);
    if (resolved !== null && /\.(md|markdown)$/i.test(resolved.path)) {
      found.add(resolved.path);
    }
    return null;
  });
  return [...found];
}

/**
 * Resolves a link target against the file it is written in, when it is a relative path.
 * @param target The link target as written.
 * @param source The linking file's path, relative to the chosen root.
 * @returns Returns the path relative to the chosen root and the anchor, or null for a link that is
 * not a relative path (the web, an absolute path, an anchor on the same page).
 */
function resolveLink(
  target: string,
  source: string,
): { readonly path: string; readonly anchor: string } | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('#')) {
    return null;
  }
  const hash: number = target.indexOf('#');
  const path: string = hash < 0 ? target : target.slice(0, hash);
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  return {
    path: posix.normalize(posix.join(posix.dirname(source), decoded)),
    anchor: hash < 0 ? '' : target.slice(hash),
  };
}

/**
 * Replaces the targets of a body's inline links and reference definitions.
 * @param body The body.
 * @param retarget Returns a target's replacement, or null to leave it.
 * @returns Returns the body.
 */
function replaceLinkTargets(body: string, retarget: (target: string) => string | null): string {
  const inline: string = body.replace(
    /(\]\()(<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?\))/g,
    (match: string, open: string, target: string, close: string): string => {
      const bare: string = target.startsWith('<') ? target.slice(1, -1) : target;
      const next: string | null = retarget(bare);
      return next === null ? match : `${open}${next}${close}`;
    },
  );
  return inline.replace(
    /^(\s{0,3}\[[^\]]+\]:\s*)(\S+)/gm,
    (match: string, label: string, target: string): string => {
      const next: string | null = retarget(target);
      return next === null ? match : `${label}${next}`;
    },
  );
}

/**
 * Finds the Markdown files under a folder, skipping hidden and dependency folders.
 * @param root The folder.
 * @returns Returns the absolute paths in path order, and whether the walk stopped at the limit.
 */
async function findMarkdown(
  root: string,
): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }> {
  const files: string[] = [];
  let truncated: boolean = false;
  const walk: (folder: string) => Promise<void> = async (folder: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    // A skill folder is one candidate: its other Markdown files are what it bundles, not skills.
    if (
      folder !== root &&
      entries.some((child: Dirent): boolean => child.isFile() && child.name === SKILL_FILE)
    ) {
      files.push(join(folder, SKILL_FILE));
      return;
    }
    for (const child of entries.sort((a: Dirent, b: Dirent): number =>
      a.name.localeCompare(b.name),
    )) {
      if (files.length >= FILE_LIMIT) {
        truncated = true;
        return;
      }
      if (child.name.startsWith('.')) {
        continue;
      }
      const path: string = join(folder, child.name);
      if (child.isDirectory()) {
        if (!SKIPPED_FOLDERS.includes(child.name)) {
          await walk(path);
        }
      } else if (child.isFile() && /\.(md|markdown)$/i.test(child.name)) {
        files.push(path);
      }
    }
  };
  await walk(root);
  return { files, truncated };
}

/**
 * Lists a skill folder's files other than its `SKILL.md`, relative to it.
 * @param folder The skill folder.
 * @returns Returns the relative paths.
 */
async function bundledFiles(folder: string): Promise<readonly string[]> {
  const found: string[] = [];
  const walk: (current: string) => Promise<void> = async (current: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of entries) {
      if (child.name === '.git' || child.name === '.DS_Store' || child.name === 'node_modules') {
        continue;
      }
      const path: string = join(current, child.name);
      if (child.isDirectory()) {
        await walk(path);
      } else if (child.isFile() && !(current === folder && child.name === SKILL_FILE)) {
        found.push(toPosix(relative(folder, path)));
      }
    }
  };
  await walk(folder);
  return found.sort();
}

/**
 * Reads the profile files of an export.
 * @param folder The export's `profiles` folder.
 * @returns Returns the profiles, in id order.
 */
async function readProfiles(folder: string): Promise<readonly PromptProfile[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const profiles: PromptProfile[] = [];
  for (const child of entries) {
    if (!child.isFile() || !child.name.endsWith('.md')) {
      continue;
    }
    const id: string = slugify(child.name.slice(0, -3));
    if (id.length === 0) {
      continue;
    }
    profiles.push(parseProfileFile(id, await fs.readFile(join(folder, child.name), 'utf8')));
  }
  return profiles.sort((a: PromptProfile, b: PromptProfile): number => a.id.localeCompare(b.id));
}

/**
 * Determines whether a file exists.
 * @param path The path.
 * @returns Returns true when a file is there.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Converts a platform path to `/` separators.
 * @param path The path.
 * @returns Returns the path with `/` separators.
 */
function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}
