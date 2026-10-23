import { inject, Service } from '@angular/core';
import { resolveTerminalPath } from '@shared/angular/components/terminal/terminal-links';
import { Documents } from '@shared/angular/services/documents/documents';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { basename, parentDir } from '@shared/angular/services/lsp/lsp-paths';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { DirectoryEntry, DirectoryListing } from '@shared/api/workspace-channels';
import { TerminalPathLinks } from './terminal-path-links';

/**
 * Holds how long a directory's listing is trusted, in milliseconds. Hovering along a compiler's
 * output asks about the same few directories line after line; a file created a moment later is
 * linked on the next hover after this.
 */
const LISTING_TTL_MS: number = 3000;

/**
 * Holds the most directory listings kept at once. Past it the cache starts over rather than tracking
 * which listing is oldest; it refills from what the pointer is over.
 */
const MAX_LISTINGS: number = 64;

/**
 * Represents a directory's files, by name, as they stood when it was read.
 */
interface CachedListing {
  /**
   * Gets when the listing was asked for.
   */
  readonly at: number;

  /**
   * Gets the directory's files: each name mapped to the file's absolute path.
   */
  readonly files: Promise<ReadonlyMap<string, string>>;
}

/**
 * Links the file paths a workspace's terminals print to the files in that workspace (#1061).
 *
 * A path is a file here when its directory's listing has it. The listing is read through the
 * workspace, whose main-process side refuses any directory outside the open roots, so a terminal
 * cannot be used to look around the rest of the disk. Opening goes to this workspace's well.
 */
@Service()
export class WorkspaceTerminalPathLinks implements TerminalPathLinks {
  /**
   * Holds the workspace, whose root a path resolves against when the terminal's directory is unknown,
   * and through which directories are read.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the opener for this workspace's document well.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds this workspace's open documents, to find the one a file opened as.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the editors, asked to put the caret on the line the terminal named.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the directories read recently, by their slash-normalised path.
   */
  private readonly listings: Map<string, CachedListing> = new Map<string, CachedListing>();

  /**
   * Resolves a path a terminal printed to the workspace file it names.
   * @param path The path as printed.
   * @param cwd The terminal's working directory, or null to resolve against the workspace root.
   * @returns Returns the file's absolute path, or null when the workspace has no such file.
   */
  public async resolve(path: string, cwd: string | null): Promise<string | null> {
    const absolute: string | null = resolveTerminalPath(
      cwd ?? this.workspace.root()?.path ?? null,
      path,
    );
    if (absolute === null) {
      return null;
    }
    const files: ReadonlyMap<string, string> = await this.filesIn(parentDir(absolute));
    return files.get(basename(absolute)) ?? null;
  }

  /**
   * Opens a workspace file in the well and, when a line is given, puts the caret there.
   * @param path The file's absolute path.
   * @param line The 1-based line, or null.
   * @param column The 1-based column, or null.
   * @returns Returns a promise that resolves once the file is open.
   */
  public async open(path: string, line: number | null, column: number | null): Promise<void> {
    if (!(await this.fileOpener.openPath(path)) || line === null) {
      return;
    }
    const documentId: string | undefined = this.documents.findIdByPath(path);
    if (documentId !== undefined) {
      this.editors.requestReveal(documentId, line, column ?? 1);
    }
  }

  /**
   * Reads the files in a directory, from the cache while it is fresh.
   * @param directory The directory's slash-normalised path.
   * @returns Returns the directory's files by name; none when it cannot be read or is outside the
   * workspace.
   */
  private filesIn(directory: string): Promise<ReadonlyMap<string, string>> {
    const now: number = Date.now();
    const cached: CachedListing | undefined = this.listings.get(directory);
    if (cached !== undefined && now - cached.at < LISTING_TTL_MS) {
      return cached.files;
    }
    if (this.listings.size >= MAX_LISTINGS) {
      this.listings.clear();
    }
    const files: Promise<ReadonlyMap<string, string>> = this.workspace
      .readDirectoryListing(directory)
      .then(
        (listing: DirectoryListing | null): ReadonlyMap<string, string> =>
          new Map<string, string>(
            (listing?.entries ?? [])
              .filter((entry: DirectoryEntry): boolean => entry.type === 'file')
              .map((entry: DirectoryEntry): [string, string] => [entry.name, entry.path]),
          ),
      )
      .catch((): ReadonlyMap<string, string> => new Map<string, string>());
    this.listings.set(directory, { at: now, files });
    return files;
  }
}
