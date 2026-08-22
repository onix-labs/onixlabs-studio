import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { FileInfo } from '@shared/api/file-channels';
import { Log } from '@shared/angular/services/log/log';
import { FileConflicts } from '../file-conflicts/file-conflicts';
import { FileSystem } from '../file-system/file-system';
import { FileWatch } from '../file-watch/file-watch';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { RecentItems, RecentKind } from '@shared/angular/services/recent-items/recent-items';
import { Tab, TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import {
  UnsavedDocument,
  UnsavedWorkSource,
} from '@shared/angular/services/unsaved-work/unsaved-work';

/**
 * Holds the file name used for a new, unsaved document.
 */
const UNTITLED_NAME: string = 'Untitled';

/**
 * Holds the default language used for a new, unsaved document.
 */
const DEFAULT_LANGUAGE: string = 'plaintext';

/**
 * Holds the encoding label assumed for a new, unsaved document.
 */
const DEFAULT_ENCODING: string = 'UTF-8';

/**
 * Represents the reactive state of a code document backing a code tab.
 */
export interface CodeDocument {
  /**
   * Gets the identifier of the owning tab.
   */
  readonly id: string;

  /**
   * Gets the absolute file path, or null when the document has never been saved.
   */
  readonly filePath: Signal<string | null>;

  /**
   * Gets the display file name.
   */
  readonly fileName: Signal<string>;

  /**
   * Gets the Monaco language identifier.
   */
  readonly language: Signal<string>;

  /**
   * Gets the current editor content.
   */
  readonly content: Signal<string>;

  /**
   * Gets the last-saved content, used as the change-margin's saved baseline. Updates on save and on
   * reload from disk.
   */
  readonly savedContent: Signal<string>;

  /**
   * Gets a value indicating whether the content differs from the last-saved content.
   */
  readonly dirty: Signal<boolean>;

  /**
   * Gets the text encoding label (for example "UTF-8").
   */
  readonly encoding: Signal<string>;

  /**
   * Gets a value indicating whether the file is, or will be saved, with a UTF-8 byte-order mark.
   */
  readonly hasBom: Signal<boolean>;
}

/**
 * Holds the mutable backing state for a {@link CodeDocument}.
 */
interface DocumentEntry {
  /**
   * Gets the readonly document facade exposed to consumers.
   */
  readonly document: CodeDocument;

  /**
   * Gets the writable file path.
   */
  readonly filePath: WritableSignal<string | null>;

  /**
   * Gets the writable file name.
   */
  readonly fileName: WritableSignal<string>;

  /**
   * Gets the writable language identifier.
   */
  readonly language: WritableSignal<string>;

  /**
   * Gets the writable current content.
   */
  readonly content: WritableSignal<string>;

  /**
   * Gets the writable last-saved content.
   */
  readonly original: WritableSignal<string>;

  /**
   * Gets the writable text encoding label.
   */
  readonly encoding: WritableSignal<string>;

  /**
   * Gets the writable byte-order-mark flag.
   */
  readonly hasBom: WritableSignal<boolean>;

  /**
   * Holds the disposer that stops watching this document's file on disk, or null when not watched.
   */
  watchDisposer: (() => void) | null;
}

/**
 * Owns the code documents backing code tabs: their content, file association and dirty state, and the
 * open/save/save-as workflow over the {@link FileSystem} bridge.
 *
 * Each code tab has one document, created lazily by the {@link CodeView}. Mutations keep the owning
 * tab's title and dirty indicator in sync.
 */
@Service()
export class Documents implements UnsavedWorkSource {
  /**
   * Holds the tabs registry the documents are associated with.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the Monaco service used for language detection.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the file-system bridge used for reads, writes and dialogs.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the file-watch service used to reload documents when their file changes on disk.
   */
  private readonly fileWatch: FileWatch = inject(FileWatch);

  /**
   * Holds the conflict registry used to prompt when a watched file changes under unsaved edits.
   */
  private readonly fileConflicts: FileConflicts = inject(FileConflicts);

  /**
   * Holds the recent-items registry used to surface saved documents on the welcome screen.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the top-level tab that hosts this document model's documents (a workspace tab for well
   * documents), or null when each document is its own top-level tab (standalone editor tabs).
   */
  private owningTabId: string | null = null;

  /**
   * Holds the document entries, keyed by document identifier (a tab id, or a well document id).
   */
  private readonly entries: Map<string, DocumentEntry> = new Map<string, DocumentEntry>();

  /**
   * Tracks structural changes to {@link entries}. The map is not reactive, yet entries are created
   * lazily (a code tab's document is materialised when its view mounts, after the tab is already
   * active). Reading this signal from {@link get} lets computeds that resolve a document by id —
   * such as the ribbon's language field — re-run when an entry appears or is removed, rather than
   * caching the absent document from their first evaluation.
   */
  private readonly entriesVersion: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the id of the document currently focused for editing, kept current by the active editor.
   * Used so save commands target the right document whether it is a tab or a document-well editor.
   */
  private readonly activeDocument: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Tracks the running counter used to generate unique document-well identifiers.
   */
  private wellSequence: number = 0;

  /**
   * Gets the id of the document currently focused for editing, or null when none is.
   */
  public readonly activeDocumentId: Signal<string | null> = this.activeDocument.asReadonly();

  /**
   * Returns the document for a tab, creating an empty document when none exists yet.
   * @param id The owning tab identifier.
   * @param defaultName The display name given to a freshly created document; defaults to `Untitled`.
   * @returns Returns the tab's code document.
   */
  public ensure(id: string, defaultName: string = UNTITLED_NAME): CodeDocument {
    const existing: DocumentEntry | undefined = this.entries.get(id);
    if (existing !== undefined) {
      return existing.document;
    }
    const entry: DocumentEntry = this.createEntry(id, defaultName);
    this.entries.set(id, entry);
    this.markEntriesChanged();
    this.syncTab(id);
    return entry.document;
  }

  /**
   * Updates the content of a tab's document, recomputing its dirty state.
   * @param id The owning tab identifier.
   * @param content The new content.
   */
  public setContent(id: string, content: string): void {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    entry.content.set(content);
    this.syncTab(id);
  }

  /**
   * Removes the document associated with a tab. Called when the tab closes.
   * @param id The owning tab identifier.
   */
  /**
   * Releases the document backing a tab. Part of the unsaved-work contract, so the tab closer can
   * release every source when a tab closes; unknown ids are a no-op.
   * @param id The owning tab identifier.
   */
  public release(id: string): void {
    this.remove(id);
  }

  public remove(id: string): void {
    this.entries.get(id)?.watchDisposer?.();
    this.fileConflicts.clear(id);
    this.entries.delete(id);
    this.markEntriesChanged();
    this.log.info('Documents', 'Closed document', id);
  }

  /**
   * Records the top-level tab that hosts this (per-workspace) document model's well documents, so a
   * file conflict surfaces on the workspace tab. The root model leaves this unset; each document is
   * then its own tab.
   * @param tabId The hosting tab's id.
   */
  public setOwningTab(tabId: string): void {
    this.owningTabId = tabId;
  }

  /**
   * Gets the document for a tab, if one exists.
   * @param id The owning tab identifier.
   * @returns Returns the tab's document, or undefined when none exists.
   */
  public get(id: string): CodeDocument | undefined {
    // Track structural changes so a computed that resolves a document by id re-runs when the entry
    // is created (entries are materialised lazily, after the tab is already active).
    this.entriesVersion();
    return this.entries.get(id)?.document;
  }

  /**
   * Records that {@link entries} has gained or lost a member, so document-resolving computeds re-run.
   */
  private markEntriesChanged(): void {
    this.entriesVersion.update((version: number): number => version + 1);
  }

  /**
   * Gets the number of documents with unsaved changes, as a signal, so surfaces that enable on unsaved
   * work (the ribbon's Save All) re-derive as documents are edited, saved, opened and closed. The
   * method form is a plain read and would not re-run them.
   */
  public readonly dirtyCount: Signal<number> = computed((): number => {
    // Track membership as well as content: a document opened or closed changes the answer without any
    // existing document's dirty state changing.
    this.entriesVersion();
    let count: number = 0;
    for (const entry of this.entries.values()) {
      if (entry.document.dirty()) {
        count += 1;
      }
    }
    return count;
  });

  /**
   * Lists the documents with unsaved changes, in insertion order.
   * @returns Returns each dirty document's id and display name.
   */
  public dirtyDocuments(): readonly UnsavedDocument[] {
    const dirty: UnsavedDocument[] = [];
    for (const entry of this.entries.values()) {
      if (entry.document.dirty()) {
        dirty.push({ id: entry.document.id, name: entry.document.fileName() });
      }
    }
    return dirty;
  }

  /**
   * Lists the dirty documents hosted by the given tab. A workspace instance hosts every well document
   * under its owning tab, so it returns all of them when that tab is the closing one; a root instance
   * backs standalone editor tabs, where each document is its own tab, so it returns the document with
   * that id.
   * @param tabId The closing tab's identifier.
   * @returns Returns the dirty documents the tab hosts.
   */
  public dirtyDocumentsFor(tabId: string): readonly UnsavedDocument[] {
    if (this.owningTabId !== null) {
      return this.owningTabId === tabId ? this.dirtyDocuments() : [];
    }
    return this.dirtyDocuments().filter(
      (document: UnsavedDocument): boolean => document.id === tabId,
    );
  }

  /**
   * Sets the language of a tab's document, so the editor re-highlights with the chosen syntax.
   * @param id The owning tab identifier.
   * @param language The Monaco language identifier to apply.
   */
  public setLanguage(id: string, language: string): void {
    this.entries.get(id)?.language.set(language);
    this.log.info('Documents', `Language changed to '${language}'`, id);
  }

  /**
   * Shows an open-file dialog and, when a file is chosen, opens it in a new code tab.
   */
  public async openFile(): Promise<void> {
    const fileInfo: FileInfo | null = await this.fileSystem.openDialog();
    if (fileInfo === null) {
      return;
    }
    const id: string = this.tabs.open('code').id;
    this.log.info('Documents', `Opened file '${fileInfo.name}'`, id, fileInfo.path);
    const entry: DocumentEntry = this.createEntry(id);
    this.entries.set(id, entry);
    this.markEntriesChanged();
    entry.filePath.set(fileInfo.path);
    entry.fileName.set(fileInfo.name);
    entry.language.set(this.monaco.getLanguageForExtension(fileInfo.extension));
    entry.content.set(fileInfo.content);
    entry.original.set(fileInfo.content);
    entry.encoding.set(fileInfo.encoding ?? DEFAULT_ENCODING);
    entry.hasBom.set(fileInfo.hasBom ?? false);
    this.syncTab(id);
    this.watchEntry(id);
  }

  /**
   * Opens an already-read file into a tab of the given type, reusing the tab if the file is already
   * open. The document is seeded with the file's content, name, path, and detected language.
   * @param fileInfo The file to open.
   * @param type The tab type to host the file (for example, `code` or `markdown`).
   * @returns Returns the opened, or re-activated, tab.
   */
  public openFileInfo(fileInfo: FileInfo, type: TabType): Tab {
    const existing: Tab | undefined = this.tabs.findByResource(type, fileInfo.path);
    if (existing !== undefined) {
      this.tabs.activate(existing.id);
      this.log.debug('Documents', `Reused open tab for '${fileInfo.name}'`, existing.id);
      return existing;
    }
    const tab: Tab = this.tabs.open(type, fileInfo.path);
    this.log.info('Documents', `Opened file '${fileInfo.name}' as ${type}`, tab.id, fileInfo.path);
    const entry: DocumentEntry = this.createEntry(tab.id);
    this.entries.set(tab.id, entry);
    this.markEntriesChanged();
    entry.filePath.set(fileInfo.path);
    entry.fileName.set(fileInfo.name);
    entry.language.set(this.monaco.getLanguageForExtension(fileInfo.extension));
    entry.content.set(fileInfo.content);
    entry.original.set(fileInfo.content);
    entry.encoding.set(fileInfo.encoding ?? DEFAULT_ENCODING);
    entry.hasBom.set(fileInfo.hasBom ?? false);
    this.syncTab(tab.id);
    this.watchEntry(tab.id);
    // syncTab renamed the tab to the file name; return the up-to-date tab, not the pre-rename one.
    return this.tabs.tabs().find((candidate: Tab): boolean => candidate.id === tab.id) ?? tab;
  }

  /**
   * Gets the content used to seed an editor that manages its own text thereafter (the markdown
   * editor): the document's **current** content, not its last-saved content.
   *
   * The distinction only shows when a document is already dirty before its editor mounts — an agent
   * opening a tab and filling it, which happens a render before the view appears. Seeding from the
   * last-saved text showed such a document as blank until the user saved it, since saving is what
   * copies the content over. The two are identical for a document opened from a file, which is why
   * this read the wrong one for so long.
   * @param id The identifier of the tab.
   * @returns Returns the document's current content, or an empty string when none is registered.
   */
  public initialContentOf(id: string): string {
    return this.entries.get(id)?.content() ?? '';
  }

  /**
   * Creates a document for a file opened into a workspace's document well, seeded with the file's
   * content, name, path, and detected language. Unlike {@link openFileInfo}, this is not backed by a
   * top-level tab; the caller hosts it as a dock document panel.
   * @param fileInfo The file to open.
   * @returns Returns the new document's identifier.
   */
  public createWellDocument(fileInfo: FileInfo): string {
    this.wellSequence += 1;
    const id: string = `well-doc-${this.wellSequence}`;
    const entry: DocumentEntry = this.createEntry(id);
    this.entries.set(id, entry);
    this.markEntriesChanged();
    entry.filePath.set(fileInfo.path);
    entry.fileName.set(fileInfo.name);
    entry.language.set(this.monaco.getLanguageForExtension(fileInfo.extension));
    entry.content.set(fileInfo.content);
    entry.original.set(fileInfo.content);
    entry.encoding.set(fileInfo.encoding ?? DEFAULT_ENCODING);
    entry.hasBom.set(fileInfo.hasBom ?? false);
    this.watchEntry(id);
    this.log.info('Documents', `Opened well document '${fileInfo.name}'`, id, fileInfo.path);
    return id;
  }

  /**
   * Finds the id of the open document backed by the given file path.
   * @param filePath The absolute file path to match.
   * @returns Returns the document id, or undefined when the file is not open.
   */
  public findIdByPath(filePath: string): string | undefined {
    for (const [id, entry] of this.entries) {
      if (entry.filePath() === filePath) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * Records which document is currently focused for editing, so save commands target it. Passing
   * null clears the focus.
   * @param id The focused document id, or null.
   */
  public setActiveDocument(id: string | null): void {
    this.activeDocument.set(id);
  }

  /**
   * Releases every document whose id is not in the given set, used to drop well documents once their
   * dock panel has been closed (as opposed to merely re-parented by a split or move).
   * @param present The ids of the documents still present.
   * @returns Returns the ids of the documents that were removed, so callers can sweep related state.
   */
  public removeMissing(present: ReadonlySet<string>): readonly string[] {
    const removed: string[] = [];
    for (const id of [...this.entries.keys()]) {
      if (!present.has(id)) {
        this.remove(id);
        removed.push(id);
      }
    }
    return removed;
  }

  /**
   * Saves the active tab's document, prompting for a path when it has never been saved.
   * @returns Returns true when the document was saved.
   */
  public saveActive(): Promise<boolean> {
    const id: string | null = this.resolveActiveId();
    return id === null ? Promise.resolve(false) : this.save(id);
  }

  /**
   * Saves every document with unsaved changes, prompting for a path for each that has never been
   * saved. Saves are sequenced rather than run together: an unsaved document opens a save dialog, and
   * several dialogs racing each other would be unusable.
   * @returns Returns true when every dirty document was saved (false when any failed or was cancelled).
   */
  public async saveAll(): Promise<boolean> {
    let saved: boolean = true;
    for (const document of this.dirtyDocuments()) {
      if (!(await this.save(document.id))) {
        saved = false;
      }
    }
    return saved;
  }

  /**
   * Saves the active tab's document to a newly chosen path.
   * @returns Returns true when the document was saved.
   */
  public saveActiveAs(): Promise<boolean> {
    const id: string | null = this.resolveActiveId();
    return id === null ? Promise.resolve(false) : this.saveAs(id);
  }

  /**
   * Resolves the document to act on for save commands: the focused editor's document, falling back
   * to the active top-level tab for standalone editor tabs.
   * @returns Returns the document id, or null when there is none.
   */
  private resolveActiveId(): string | null {
    return this.activeDocument() ?? this.tabs.activeTabId() ?? null;
  }

  /**
   * Saves a tab's document, prompting for a path when it has never been saved.
   * @param id The owning tab identifier.
   * @returns Returns true when the document was saved.
   */
  public async save(id: string): Promise<boolean> {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined) {
      return false;
    }
    const filePath: string | null = entry.filePath();
    if (filePath === null) {
      return this.saveAs(id);
    }
    const content: string = entry.content();
    const success: boolean = (await this.fileSystem.write(filePath, content, entry.hasBom()))
      .success;
    if (success) {
      entry.original.set(content);
      this.syncTab(id);
      this.recordRecent(entry);
      this.log.info('Documents', `Saved '${entry.fileName()}'`, id, filePath);
    } else {
      this.log.warn('Documents', `Save failed for '${entry.fileName()}'`, id, filePath);
    }
    return success;
  }

  /**
   * Saves a tab's document to a newly chosen path, updating its file association and language.
   * @param id The owning tab identifier.
   * @returns Returns true when the document was saved.
   */
  public async saveAs(id: string): Promise<boolean> {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined) {
      return false;
    }
    const suggested: string = entry.filePath() ?? this.suggestedFileName(entry);
    const targetPath: string | null = await this.fileSystem.saveDialog(suggested);
    if (targetPath === null) {
      return false;
    }
    const content: string = entry.content();
    const success: boolean = (await this.fileSystem.write(targetPath, content, entry.hasBom()))
      .success;
    if (success) {
      entry.filePath.set(targetPath);
      entry.fileName.set(this.basename(targetPath));
      entry.language.set(this.monaco.getLanguageForExtension(this.extname(targetPath)));
      entry.original.set(content);
      this.syncTab(id);
      this.watchEntry(id);
      this.recordRecent(entry);
      this.log.info('Documents', `Saved as '${entry.fileName()}'`, id, targetPath);
    } else {
      this.log.warn('Documents', 'Save-as failed', id, targetPath);
    }
    return success;
  }

  /**
   * Records a saved document as a recent item so it surfaces on the welcome screen. Skipped for a
   * per-workspace well model (one with an owning tab): a file living inside a workspace is not itself a
   * recent item — only the workspace is — so saving it must not surface it on the welcome screen.
   * @param entry The saved document entry.
   */
  private recordRecent(entry: DocumentEntry): void {
    if (this.owningTabId !== null) {
      return;
    }
    const filePath: string | null = entry.filePath();
    if (filePath === null) {
      return;
    }
    const kind: RecentKind = entry.language() === 'markdown' ? 'markdown' : 'code';
    this.recentItems.record(filePath, entry.fileName(), kind);
  }

  /**
   * Creates an empty untitled document entry for a tab.
   * @param id The owning tab identifier.
   * @param defaultName The display name given to the new document; defaults to `Untitled`.
   * @returns Returns the created entry.
   */
  private createEntry(id: string, defaultName: string = UNTITLED_NAME): DocumentEntry {
    const filePath: WritableSignal<string | null> = signal<string | null>(null);
    const fileName: WritableSignal<string> = signal<string>(defaultName);
    const language: WritableSignal<string> = signal<string>(DEFAULT_LANGUAGE);
    const content: WritableSignal<string> = signal<string>('');
    const original: WritableSignal<string> = signal<string>('');
    const encoding: WritableSignal<string> = signal<string>(DEFAULT_ENCODING);
    const hasBom: WritableSignal<boolean> = signal<boolean>(false);
    const dirty: Signal<boolean> = computed((): boolean => content() !== original());
    const document: CodeDocument = {
      id,
      filePath: filePath.asReadonly(),
      fileName: fileName.asReadonly(),
      language: language.asReadonly(),
      content: content.asReadonly(),
      savedContent: original.asReadonly(),
      dirty,
      encoding: encoding.asReadonly(),
      hasBom: hasBom.asReadonly(),
    };
    return {
      document,
      filePath,
      fileName,
      language,
      content,
      original,
      encoding,
      hasBom,
      watchDisposer: null,
    };
  }

  /**
   * Watches the document's file on disk, reloading it on change (or, when there are unsaved edits,
   * leaving them untouched). Re-registers against the current path; disposes any prior watch.
   * @param id The document identifier.
   */
  private watchEntry(id: string): void {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    entry.watchDisposer?.();
    entry.watchDisposer = null;
    const filePath: string | null = entry.filePath();
    if (filePath !== null) {
      entry.watchDisposer = this.fileWatch.watch(filePath, (info: FileInfo): void =>
        this.onDiskChange(id, info),
      );
    }
  }

  /**
   * Handles a watched document's file changing on disk. Reloads the document when it has no unsaved
   * edits; when it is dirty, raises a keep/reload conflict for the user to resolve.
   * @param id The document identifier.
   * @param info The freshly-read file.
   */
  private onDiskChange(id: string, info: FileInfo): void {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined || entry.content() === info.content) {
      return;
    }
    if (!entry.document.dirty()) {
      this.reloadFromDisk(id, info.content);
      return;
    }
    // Unsaved edits diverge from a new on-disk version: prompt the user to keep or reload.
    this.log.warn('Documents', `Conflict: '${entry.fileName()}' changed on disk while dirty`, id);
    this.fileConflicts.raise(
      { documentId: id, tabId: this.owningTabId ?? id, name: entry.fileName() },
      { keep: (): void => undefined, reload: (): void => this.reloadFromDisk(id, info.content) },
    );
  }

  /**
   * Reloads a document from disk content, replacing its content and last-saved baseline so the
   * document is clean and the live editor refreshes.
   * @param id The document identifier.
   * @param content The new on-disk content.
   */
  private reloadFromDisk(id: string, content: string): void {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    entry.content.set(content);
    entry.original.set(content);
    this.syncTab(id);
    this.log.info('Documents', `Reloaded '${entry.fileName()}' from disk`, id);
  }

  /**
   * Reflects a document's file name and dirty state onto its owning tab.
   * @param id The owning tab identifier.
   */
  private syncTab(id: string): void {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    const tab: Tab | undefined = this.tabs
      .tabs()
      .find((candidate: Tab): boolean => candidate.id === id);
    if (tab === undefined) {
      return;
    }
    const fileName: string = entry.fileName();
    const dirty: boolean = entry.document.dirty();
    if (tab.title !== fileName) {
      this.tabs.rename(id, fileName);
    }
    if ((tab.dirty ?? false) !== dirty) {
      this.tabs.setDirty(id, dirty);
    }
  }

  /**
   * Extracts the file name from a path.
   * @param filePath The path to extract from.
   * @returns Returns the final path segment.
   */
  private basename(filePath: string): string {
    const segments: string[] = filePath.split(/[\\/]/);
    return segments[segments.length - 1];
  }

  /**
   * Builds the file name suggested in the save dialog for a new document, appending the extension for
   * the document's language (for example `.md` for markdown) when its name does not already carry one.
   * @param entry The document entry being saved.
   * @returns Returns the suggested file name.
   */
  private suggestedFileName(entry: DocumentEntry): string {
    const name: string = entry.fileName();
    if (this.extname(name) !== '') {
      return name;
    }
    const extension: string = this.monaco.getExtensionForLanguage(entry.language());
    return extension === '' ? name : `${name}${extension}`;
  }

  /**
   * Extracts the extension (including the leading dot) from a path.
   * @param filePath The path to extract from.
   * @returns Returns the extension, or an empty string when there is none.
   */
  private extname(filePath: string): string {
    const name: string = this.basename(filePath);
    const dot: number = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
  }
}
