import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ProjectItemNode, ProjectItems } from '@shared/api/project-system';
import { logger } from '../logger';

/**
 * The cache format's version. A file written in any other version is ignored, and replaced the next
 * time the root's projects are evaluated, so a format change never shows a misread tree.
 */
export const PROJECT_ITEMS_CACHE_VERSION: number = 1;

/**
 * How long, in milliseconds, a root's changes are gathered before its file is written, so a solution
 * opening writes once rather than once per project.
 */
const WRITE_DELAY_MS: number = 2_000;

/**
 * The largest file written for one root, in bytes. A root past it is not cached: reading it back would
 * cost more than the cache saves.
 */
const MAX_FILE_BYTES: number = 8 * 1024 * 1024;

/**
 * How long, in milliseconds, a root's file is kept after it was last written.
 */
const MAX_AGE_MS: number = 90 * 24 * 60 * 60 * 1000;

/**
 * The most roots kept; the least recently written go first.
 */
const MAX_FILES: number = 200;

/**
 * Describes a root's file as it is written.
 */
interface CacheFile {
  /**
   * Gets the cache format's version.
   */
  readonly version: number;

  /**
   * Gets the root the file belongs to, checked on read so a file can never answer for another root.
   */
  readonly root: string;

  /**
   * Gets each project's contents, by project path.
   */
  readonly projects: Readonly<Record<string, ProjectItems>>;
}

/**
 * Keeps the last evaluated contents of each root's projects in Studio's own user-data folder (#1601),
 * so reopening a solution can show its tree at once while the projects are evaluated again behind it.
 *
 * Nothing is written into the workspace. Only contents from a trusted evaluation are given to it, and
 * the caller asks for them back only for projects that are trusted now; an entry is otherwise just a
 * picture of the tree, replaced within seconds by the evaluation that follows, so a stale one costs
 * nothing worse than a brief flicker. Every failure degrades to "nothing cached".
 */
export class ProjectItemsCache {
  /**
   * Holds the folder the roots' files are written to.
   */
  private readonly directory: string;

  /**
   * Holds each root's contents as last read or written, by root.
   */
  private readonly roots: Map<string, Map<string, ProjectItems>> = new Map<
    string,
    Map<string, ProjectItems>
  >();

  /**
   * Holds each root's pending write.
   */
  private readonly writes: Map<string, NodeJS.Timeout> = new Map<string, NodeJS.Timeout>();

  /**
   * Initializes a new instance of the {@link ProjectItemsCache} class.
   * @param directory The folder the roots' files are written to; created when first needed.
   */
  public constructor(directory: string) {
    this.directory = directory;
  }

  /**
   * Reads a root's cached contents.
   * @param root The absolute workspace root.
   * @returns Returns each project's contents, by project path; empty when nothing usable is cached.
   */
  public async read(root: string): Promise<ReadonlyMap<string, ProjectItems>> {
    const known: Map<string, ProjectItems> | undefined = this.roots.get(root);
    if (known !== undefined) {
      return known;
    }
    const projects: Map<string, ProjectItems> = await this.load(root);
    // A write that landed while the file was read wins over what the file said.
    const raced: Map<string, ProjectItems> | undefined = this.roots.get(root);
    if (raced !== undefined) {
      return raced;
    }
    this.roots.set(root, projects);
    return projects;
  }

  /**
   * Records a project's freshly evaluated contents and schedules the root's file to be written.
   * @param root The absolute workspace root the project was opened under.
   * @param items The project's contents.
   */
  public remember(root: string, items: ProjectItems): void {
    let projects: Map<string, ProjectItems> | undefined = this.roots.get(root);
    if (projects === undefined) {
      projects = new Map<string, ProjectItems>();
      this.roots.set(root, projects);
    }
    projects.set(items.projectPath, items);
    this.scheduleWrite(root);
  }

  /**
   * Drops the projects a root no longer has, so its file does not grow with projects long gone.
   * @param root The absolute workspace root.
   * @param projectPaths The root's projects now.
   */
  public retain(root: string, projectPaths: readonly string[]): void {
    const projects: Map<string, ProjectItems> | undefined = this.roots.get(root);
    if (projects === undefined) {
      return;
    }
    const keep: ReadonlySet<string> = new Set<string>(projectPaths);
    let dropped: boolean = false;
    for (const projectPath of [...projects.keys()]) {
      if (!keep.has(projectPath)) {
        projects.delete(projectPath);
        dropped = true;
      }
    }
    if (dropped) {
      this.scheduleWrite(root);
    }
  }

  /**
   * Writes every pending root at once, for when the app quits: synchronously, because the app does not
   * wait for anything still in flight as it exits.
   */
  public flushSync(): void {
    for (const [root, timer] of [...this.writes]) {
      clearTimeout(timer);
      this.writes.delete(root);
      const text: string | null = this.contentFor(root);
      const file: string = this.fileFor(root);
      try {
        if (text === null) {
          rmSync(file, { force: true });
          continue;
        }
        mkdirSync(this.directory, { recursive: true });
        const temporary: string = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, text, 'utf8');
        renameSync(temporary, file);
      } catch (error: unknown) {
        logger.warn('ProjectItemsCache', `Could not write the cache for '${root}'.`, error);
      }
    }
  }

  /**
   * Removes the files of roots not written for a long while, and the oldest past the most kept.
   * @param now The current time, in milliseconds since the epoch.
   * @returns Returns a promise that resolves once the folder has been tidied.
   */
  public async prune(now: number = Date.now()): Promise<void> {
    let names: string[];
    try {
      names = (await fs.readdir(this.directory)).filter((name: string): boolean =>
        name.endsWith('.json'),
      );
    } catch {
      return;
    }
    const files: { file: string; written: number }[] = [];
    for (const name of names) {
      const file: string = path.join(this.directory, name);
      try {
        files.push({ file, written: (await fs.stat(file)).mtimeMs });
      } catch {
        // Gone already.
      }
    }
    files.sort(
      (left: { written: number }, right: { written: number }): number =>
        right.written - left.written,
    );
    const doomed: string[] = files
      .filter(
        (entry: { written: number }, index: number): boolean =>
          index >= MAX_FILES || now - entry.written > MAX_AGE_MS,
      )
      .map((entry: { file: string }): string => entry.file);
    await Promise.all(
      doomed.map((file: string): Promise<void> =>
        fs.rm(file, { force: true }).catch(() => undefined),
      ),
    );
    if (doomed.length > 0) {
      logger.debug('ProjectItemsCache', `Removed ${doomed.length} old cache file(s).`);
    }
  }

  /**
   * Gets the file a root's contents are written to: named for a hash of the root, so no path is
   * spelled out in a file name.
   * @param root The absolute workspace root.
   * @returns Returns the file's path.
   */
  private fileFor(root: string): string {
    const digest: string = createHash('sha256').update(root).digest('hex').slice(0, 32);
    return path.join(this.directory, `${digest}.json`);
  }

  /**
   * Arms (or re-arms) a root's write.
   * @param root The absolute workspace root.
   */
  private scheduleWrite(root: string): void {
    clearTimeout(this.writes.get(root));
    this.writes.set(
      root,
      setTimeout((): void => {
        this.writes.delete(root);
        void this.write(root);
      }, WRITE_DELAY_MS).unref(),
    );
  }

  /**
   * Writes a root's file, through a temporary file so a reader never sees half of one.
   * @param root The absolute workspace root.
   * @returns Returns a promise that resolves once the write has settled, whether or not it succeeded.
   */
  private async write(root: string): Promise<void> {
    if (!this.roots.has(root)) {
      return;
    }
    const file: string = this.fileFor(root);
    const text: string | null = this.contentFor(root);
    try {
      if (text === null) {
        await fs.rm(file, { force: true });
        return;
      }
      await fs.mkdir(this.directory, { recursive: true });
      const temporary: string = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, text, 'utf8');
      await fs.rename(temporary, file);
    } catch (error: unknown) {
      logger.warn('ProjectItemsCache', `Could not write the cache for '${root}'.`, error);
    }
  }

  /**
   * Gets the text of a root's file.
   * @param root The absolute workspace root.
   * @returns Returns the text, or null when the root has nothing to keep or too much to be worth it.
   */
  private contentFor(root: string): string | null {
    const projects: Map<string, ProjectItems> | undefined = this.roots.get(root);
    if (projects === undefined || projects.size === 0) {
      return null;
    }
    const content: CacheFile = {
      version: PROJECT_ITEMS_CACHE_VERSION,
      root,
      projects: Object.fromEntries(projects),
    };
    const text: string = JSON.stringify(content);
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
      logger.debug('ProjectItemsCache', `Not caching '${root}': its projects are too large.`);
      return null;
    }
    return text;
  }

  /**
   * Reads a root's file, keeping only what is well formed and belongs to the root.
   * @param root The absolute workspace root.
   * @returns Returns each project's contents, by project path; empty when nothing usable is cached.
   */
  private async load(root: string): Promise<Map<string, ProjectItems>> {
    const projects: Map<string, ProjectItems> = new Map<string, ProjectItems>();
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.fileFor(root), 'utf8'));
    } catch {
      return projects;
    }
    const file: Partial<CacheFile> = parsed ?? {};
    if (
      file.version !== PROJECT_ITEMS_CACHE_VERSION ||
      file.root !== root ||
      typeof file.projects !== 'object' ||
      file.projects === null
    ) {
      return projects;
    }
    for (const [projectPath, items] of Object.entries(file.projects as Record<string, unknown>)) {
      if (isItemsFor(projectPath, root, items)) {
        projects.set(projectPath, items);
      }
    }
    return projects;
  }
}

/**
 * Determines whether a cached entry is a well-formed project's contents, for a project in the root.
 * @param projectPath The project path the entry is filed under.
 * @param root The absolute workspace root.
 * @param value The entry.
 * @returns Returns true when the entry can be shown.
 */
function isItemsFor(projectPath: string, root: string, value: unknown): value is ProjectItems {
  const items: { projectPath?: unknown; tree?: unknown } = value ?? {};
  return (
    items.projectPath === projectPath &&
    isWithin(projectPath, root) &&
    Array.isArray(items.tree) &&
    (items.tree as readonly unknown[]).every(isNode)
  );
}

/**
 * Determines whether a cached tree node is well formed. Its paths are not confined to the root: a
 * linked file may live outside it, and opening any file goes through the workspace's own checks.
 * @param value The node.
 * @returns Returns true when the node can be shown.
 */
function isNode(value: unknown): value is ProjectItemNode {
  const node: { type?: unknown; name?: unknown; path?: unknown; children?: unknown } = value ?? {};
  if (typeof node.name !== 'string') {
    return false;
  }
  if (node.type === 'file') {
    return typeof node.path === 'string';
  }
  return (
    node.type === 'folder' &&
    (node.path === null || typeof node.path === 'string') &&
    Array.isArray(node.children) &&
    (node.children as readonly unknown[]).every(isNode)
  );
}

/**
 * Determines whether a path lies inside a root.
 * @param target The path.
 * @param root The absolute root.
 * @returns Returns true when the path is the root or beneath it.
 */
function isWithin(target: string, root: string): boolean {
  const relative: string = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
