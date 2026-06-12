import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { FileInfo } from '../../../shared/studio-api';
import { FileSystem } from '../file-system/file-system';
import { Monaco } from '../monaco/monaco';
import { Tab, TabType } from '../tabs/tab';
import { Tabs } from '../tabs/tabs';

/**
 * Holds the file name used for a new, unsaved document.
 */
const UNTITLED_NAME: string = 'Untitled';

/**
 * Holds the default language used for a new, unsaved document.
 */
const DEFAULT_LANGUAGE: string = 'plaintext';

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
   * Gets a value indicating whether the content differs from the last-saved content.
   */
  readonly dirty: Signal<boolean>;
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
}

/**
 * Owns the code documents backing code tabs: their content, file association and dirty state, and the
 * open/save/save-as workflow over the {@link FileSystem} bridge.
 *
 * Each code tab has one document, created lazily by the {@link CodeView}. Mutations keep the owning
 * tab's title and dirty indicator in sync.
 */
@Service()
export class Documents {
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
   * Holds the document entries, keyed by tab identifier.
   */
  private readonly entries: Map<string, DocumentEntry> = new Map<string, DocumentEntry>();

  /**
   * Returns the document for a tab, creating an empty untitled document when none exists yet.
   * @param id The owning tab identifier.
   * @returns Returns the tab's code document.
   */
  public ensure(id: string): CodeDocument {
    const existing: DocumentEntry | undefined = this.entries.get(id);
    if (existing !== undefined) {
      return existing.document;
    }
    const entry: DocumentEntry = this.createEntry(id);
    this.entries.set(id, entry);
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
  public remove(id: string): void {
    this.entries.delete(id);
  }

  /**
   * Gets the document for a tab, if one exists.
   * @param id The owning tab identifier.
   * @returns Returns the tab's document, or undefined when none exists.
   */
  public get(id: string): CodeDocument | undefined {
    return this.entries.get(id)?.document;
  }

  /**
   * Sets the language of a tab's document, so the editor re-highlights with the chosen syntax.
   * @param id The owning tab identifier.
   * @param language The Monaco language identifier to apply.
   */
  public setLanguage(id: string, language: string): void {
    this.entries.get(id)?.language.set(language);
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
    const entry: DocumentEntry = this.createEntry(id);
    this.entries.set(id, entry);
    entry.filePath.set(fileInfo.path);
    entry.fileName.set(fileInfo.name);
    entry.language.set(this.monaco.getLanguageForExtension(fileInfo.extension));
    entry.content.set(fileInfo.content);
    entry.original.set(fileInfo.content);
    this.syncTab(id);
  }

  /**
   * Saves the active tab's document, prompting for a path when it has never been saved.
   * @returns Returns true when the document was saved.
   */
  /**
   * Opens an already-read file into a tab of the given type, reusing the tab if the file is already
   * open. The document is seeded with the file's content, name, path, and detected language.
   * @param fileInfo The file to open.
   * @param type The tab type to host the file (for example, `code` or `markdown`).
   * @returns Returns the opened, or re-activated, tab.
   */
  public openFileInfo(fileInfo: FileInfo, type: TabType): Tab {
    const existing: Tab | undefined = this.findTabByPath(fileInfo.path);
    if (existing !== undefined) {
      this.tabs.activate(existing.id);
      return existing;
    }
    const tab: Tab = this.tabs.open(type);
    const entry: DocumentEntry = this.createEntry(tab.id);
    this.entries.set(tab.id, entry);
    entry.filePath.set(fileInfo.path);
    entry.fileName.set(fileInfo.name);
    entry.language.set(this.monaco.getLanguageForExtension(fileInfo.extension));
    entry.content.set(fileInfo.content);
    entry.original.set(fileInfo.content);
    this.syncTab(tab.id);
    // syncTab renamed the tab to the file name; return the up-to-date tab, not the pre-rename one.
    return this.tabs.tabs().find((candidate: Tab): boolean => candidate.id === tab.id) ?? tab;
  }

  /**
   * Gets the initial (last-saved) content of a document, used to seed an editor that manages its own
   * content thereafter. Returns an empty string when no document is registered for the tab.
   * @param id The identifier of the tab.
   * @returns Returns the document's last-saved content, or an empty string.
   */
  public initialContentOf(id: string): string {
    return this.entries.get(id)?.original() ?? '';
  }

  public saveActive(): Promise<boolean> {
    const id: string | undefined = this.tabs.activeTabId();
    return id === undefined ? Promise.resolve(false) : this.save(id);
  }

  /**
   * Saves the active tab's document to a newly chosen path.
   * @returns Returns true when the document was saved.
   */
  public saveActiveAs(): Promise<boolean> {
    const id: string | undefined = this.tabs.activeTabId();
    return id === undefined ? Promise.resolve(false) : this.saveAs(id);
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
    const success: boolean = (await this.fileSystem.write(filePath, content)).success;
    if (success) {
      entry.original.set(content);
      this.syncTab(id);
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
    const suggested: string = entry.filePath() ?? entry.fileName();
    const targetPath: string | null = await this.fileSystem.saveDialog(suggested);
    if (targetPath === null) {
      return false;
    }
    const content: string = entry.content();
    const success: boolean = (await this.fileSystem.write(targetPath, content)).success;
    if (success) {
      entry.filePath.set(targetPath);
      entry.fileName.set(this.basename(targetPath));
      entry.language.set(this.monaco.getLanguageForExtension(this.extname(targetPath)));
      entry.original.set(content);
      this.syncTab(id);
    }
    return success;
  }

  /**
   * Creates an empty untitled document entry for a tab.
   * @param id The owning tab identifier.
   * @returns Returns the created entry.
   */
  private createEntry(id: string): DocumentEntry {
    const filePath: WritableSignal<string | null> = signal<string | null>(null);
    const fileName: WritableSignal<string> = signal<string>(UNTITLED_NAME);
    const language: WritableSignal<string> = signal<string>(DEFAULT_LANGUAGE);
    const content: WritableSignal<string> = signal<string>('');
    const original: WritableSignal<string> = signal<string>('');
    const dirty: Signal<boolean> = computed((): boolean => content() !== original());
    const document: CodeDocument = {
      id,
      filePath: filePath.asReadonly(),
      fileName: fileName.asReadonly(),
      language: language.asReadonly(),
      content: content.asReadonly(),
      dirty,
    };
    return { document, filePath, fileName, language, content, original };
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
  /**
   * Finds the open tab whose document is backed by the given file path.
   * @param filePath The absolute file path to match.
   * @returns Returns the matching tab, or undefined when the file is not open.
   */
  private findTabByPath(filePath: string): Tab | undefined {
    for (const [id, entry] of this.entries) {
      if (entry.filePath() === filePath) {
        return this.tabs.tabs().find((tab: Tab): boolean => tab.id === id);
      }
    }
    return undefined;
  }

  private basename(filePath: string): string {
    const segments: string[] = filePath.split(/[\\/]/);
    return segments[segments.length - 1];
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
