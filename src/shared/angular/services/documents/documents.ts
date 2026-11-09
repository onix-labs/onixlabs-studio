import {
  computed,
  DestroyRef,
  effect,
  inject,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { FileInfo, FileWriteResult } from '@shared/api/file-channels';
import type {
  EditorConfigCharset,
  EditorConfigProperties,
  EditorConfigResolution,
} from '@shared/api/editor-config-channels';
import type { TextEncoding } from '@shared/api/text-encodings';
import { EditorConfigs } from '@shared/angular/services/editor-config/editor-configs';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Settings, type TextEditorSettings } from '@shared/angular/services/settings/settings';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { Log } from '@shared/angular/services/log/log';
import {
  applySaveRules,
  DocumentSavePreparer,
  DocumentSaveRules,
  resolveSaveRules,
  saveRulesWhileTyping,
} from './document-save-rules';
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
 * Holds the encoding assumed for a file read without saying which (synthesised file infos).
 */
const ASSUMED_ENCODING: TextEncoding = 'utf8';

/**
 * Holds the encoding each `.editorconfig` charset names.
 */
const CHARSET_ENCODINGS: Readonly<Record<EditorConfigCharset, TextEncoding>> = {
  latin1: 'iso88591',
  'utf-8': 'utf8',
  'utf-8-bom': 'utf8',
  'utf-16be': 'utf16be',
  'utf-16le': 'utf16le',
};

/**
 * Holds how long after typing stops an edited document saves itself when Auto Save is After a Delay,
 * in milliseconds.
 */
export const AUTO_SAVE_DELAY_MS: number = 1000;

/**
 * Holds how long a save waits for the editor to format a document, in milliseconds, before saving the
 * text as it stands.
 */
export const SAVE_PREPARATION_TIMEOUT_MS: number = 3000;

/**
 * The view toggles a code tab may set for itself — word wrap, the minimap, line numbers — each unset
 * until the user flips it in that tab. An unset toggle follows the setting as it applies to the file
 * (the global value, or the language's override); a set one holds for that tab only, and goes with
 * it. Flipping one never changes a setting.
 */
export interface CodeViewToggles {
  /**
   * Gets whether long lines wrap in this tab, when the user has chosen.
   */
  readonly wordWrap?: boolean;

  /**
   * Gets whether this tab shows the minimap, when the user has chosen.
   */
  readonly minimap?: boolean;

  /**
   * Gets whether this tab shows line numbers, when the user has chosen.
   */
  readonly lineNumbers?: boolean;
}

/**
 * Resolves the view toggles in force in a code tab: each one the tab set for itself, otherwise the
 * setting as it applies to the file.
 * @param view The toggles the tab set.
 * @param settings The editor settings resolved for the file's language.
 * @returns Returns every toggle's value in the tab.
 */
export function effectiveViewToggles(
  view: CodeViewToggles,
  settings: Pick<TextEditorSettings, 'wordWrap' | 'showMinimap' | 'showLineNumbers'>,
): Required<CodeViewToggles> {
  return {
    wordWrap: view.wordWrap ?? settings.wordWrap,
    minimap: view.minimap ?? settings.showMinimap,
    lineNumbers: view.lineNumbers ?? settings.showLineNumbers,
  };
}

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
   * Gets the text encoding the document is read and saved in.
   */
  readonly encoding: Signal<TextEncoding>;

  /**
   * Gets a value indicating whether the file is, or will be saved, with its encoding's byte-order
   * mark.
   */
  readonly hasBom: Signal<boolean>;

  /**
   * Gets what EditorConfig says about the file, or null when it says nothing.
   */
  readonly editorConfig: Signal<EditorConfigProperties | null>;

  /**
   * Gets a value indicating whether the document can only be read: its editor refuses changes, it is
   * never dirty, and it is never saved — a language server's decompiled source (#1133).
   */
  readonly readOnly: Signal<boolean>;

  /**
   * Gets the view toggles this tab has set for itself. Writable by the ribbon and the document's
   * tool strip; it is view state of the open tab, never saved and never part of the file.
   */
  readonly view: WritableSignal<CodeViewToggles>;
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
   * Gets the writable text encoding.
   */
  readonly encoding: WritableSignal<TextEncoding>;

  /**
   * Gets the writable byte-order-mark flag.
   */
  readonly hasBom: WritableSignal<boolean>;

  /**
   * Gets the writable read-only flag.
   */
  readonly readOnly: WritableSignal<boolean>;

  /**
   * Holds the disposer that stops watching this document's file on disk, or null when not watched.
   */
  watchDisposer: (() => void) | null;

  /**
   * Gets or sets the function stopping the watch on the `.editorconfig` files covering the file.
   */
  editorConfigDisposer: (() => void) | null;

  /**
   * Gets what EditorConfig says about the file, or null when it says nothing.
   */
  readonly editorConfig: WritableSignal<EditorConfigProperties | null>;

  /**
   * Gets or sets the encoding the file had before an `.editorconfig` chose another, so taking that
   * charset away restores it.
   */
  encodingBeforeEditorConfig: { readonly encoding: TextEncoding; readonly hasBom: boolean } | null;

  /**
   * Gets or sets the text last written where it differs from the document's, so the file changing
   * to it is not mistaken for someone else's edit.
   */
  lastWritten: string | null;
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
   * Holds the EditorConfig resolver, whose answers override the settings for a document's file.
   */
  private readonly editorConfigs: EditorConfigs = inject(EditorConfigs);

  /**
   * Holds the conflict registry used to prompt when a watched file changes under unsaved edits.
   */
  private readonly fileConflicts: FileConflicts = inject(FileConflicts);

  /**
   * Holds the recent-items registry used to surface saved documents on the welcome screen.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Holds the dock panel registry a well document's tab is registered with. A well document has no
   * top-level tab; its dock panel is the tab whose title follows the file. The root model resolves
   * the root registry, which holds no well documents, so its lookups simply miss.
   */
  private readonly dockPanels: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the settings, read for the language a new document starts in and for auto save.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the notifications, which say why a save failed.
   */
  private readonly notifications: Notifications = inject(Notifications);

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
   * Holds each document's pending Auto Save, while typing has not yet paused for the delay.
   */
  private readonly autoSaveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * Holds the documents an Auto Save is writing now, so a second is not started over it.
   */
  private readonly autoSaving: Set<string> = new Set<string>();

  /**
   * Holds what readies each document open in an editor for saving.
   */
  private readonly savePreparers: Map<string, DocumentSavePreparer> = new Map<
    string,
    DocumentSavePreparer
  >();

  /**
   * Initializes a new instance of the {@link Documents} class, saving edited documents when the
   * window loses focus and Auto Save is When Focus Changes.
   */
  public constructor() {
    const onBlur: () => void = (): void => {
      if (this.settings.get('textEditor.autoSave') === 'focus') {
        for (const id of [...this.entries.keys()]) {
          void this.autoSave(id, false);
        }
      }
    };
    window.addEventListener('blur', onBlur);
    let honoured: boolean | undefined;
    effect((): void => {
      const honour: boolean = this.settings.value('textEditor.honourEditorConfig')();
      if (honoured !== undefined) {
        for (const id of [...this.entries.keys()]) {
          void this.refreshEditorConfig(id);
        }
      }
      honoured = honour;
    });
    inject(DestroyRef).onDestroy((): void => {
      window.removeEventListener('blur', onBlur);
      for (const timer of this.autoSaveTimers.values()) {
        clearTimeout(timer);
      }
      this.autoSaveTimers.clear();
    });
  }

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
    this.scheduleAutoSave(id);
  }

  /**
   * Starts, or restarts, a document's Auto Save when Auto Save is After a Delay: it saves once typing
   * has paused for {@link AUTO_SAVE_DELAY_MS}.
   * @param id The document identifier.
   */
  private scheduleAutoSave(id: string): void {
    const pending: ReturnType<typeof setTimeout> | undefined = this.autoSaveTimers.get(id);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.autoSaveTimers.delete(id);
    }
    if (this.settings.get('textEditor.autoSave') !== 'delay') {
      return;
    }
    this.autoSaveTimers.set(
      id,
      setTimeout((): void => {
        this.autoSaveTimers.delete(id);
        void this.autoSave(id, true);
      }, AUTO_SAVE_DELAY_MS),
    );
  }

  /**
   * Saves a document on its own, for Auto Save: only one with a file to go to, edits to save and no
   * save of its own already writing. Never asks anything — a document never saved yet is left for
   * the user to save.
   * @param id The document identifier.
   * @param whileTyping Whether the user may still be typing, as an Auto Save after a delay assumes.
   * @returns Resolves once the save, if any, has finished.
   */
  private async autoSave(id: string, whileTyping: boolean): Promise<void> {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (
      entry === undefined ||
      entry.filePath() === null ||
      entry.readOnly() ||
      !entry.document.dirty() ||
      this.autoSaving.has(id)
    ) {
      return;
    }
    this.autoSaving.add(id);
    try {
      this.log.debug('Documents', `Auto-saving '${entry.fileName()}'`, id);
      await this.save(id, whileTyping);
    } finally {
      this.autoSaving.delete(id);
    }
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
    const pending: ReturnType<typeof setTimeout> | undefined = this.autoSaveTimers.get(id);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.autoSaveTimers.delete(id);
    }
    this.entries.get(id)?.watchDisposer?.();
    this.entries.get(id)?.editorConfigDisposer?.();
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
   * Lists every document this registry holds, in the order they were created.
   * @returns Returns the documents.
   */
  public list(): readonly CodeDocument[] {
    this.entriesVersion();
    return [...this.entries.values()].map((entry: DocumentEntry): CodeDocument => entry.document);
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
   * Shows an open-file dialog and opens each chosen file in its own code tab.
   */
  public async openFile(): Promise<void> {
    for (const fileInfo of await this.fileSystem.openDialog()) {
      this.openChosenFile(fileInfo);
    }
  }

  /**
   * Opens a file chosen from the open dialog in a new code tab. Distinct from the public
   * {@link openFileInfo}, which reuses a tab already showing the file; a file picked explicitly from
   * the dialog always gets its own tab, as it did before the dialog became multi-select.
   * @param fileInfo The file to open.
   */
  private openChosenFile(fileInfo: FileInfo): void {
    const id: string = this.tabs.open('code').id;
    this.log.info('Documents', `Opened file '${fileInfo.name}'`, id, fileInfo.path);
    const entry: DocumentEntry = this.createEntry(id);
    this.entries.set(id, entry);
    this.markEntriesChanged();
    entry.filePath.set(fileInfo.path);
    entry.fileName.set(fileInfo.name);
    entry.language.set(this.monaco.getLanguageForFileName(fileInfo.name));
    entry.content.set(fileInfo.content);
    entry.original.set(fileInfo.content);
    entry.encoding.set(fileInfo.encoding ?? ASSUMED_ENCODING);
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
    entry.language.set(this.monaco.getLanguageForFileName(fileInfo.name));
    entry.content.set(fileInfo.content);
    entry.original.set(fileInfo.content);
    entry.encoding.set(fileInfo.encoding ?? ASSUMED_ENCODING);
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
    entry.language.set(this.monaco.getLanguageForFileName(fileInfo.name));
    entry.content.set(fileInfo.content);
    entry.original.set(fileInfo.content);
    entry.encoding.set(fileInfo.encoding ?? ASSUMED_ENCODING);
    entry.hasBom.set(fileInfo.hasBom ?? false);
    entry.readOnly.set(fileInfo.readOnly === true);
    this.watchEntry(id);
    this.log.info(
      'Documents',
      `Opened well document '${fileInfo.name}'${fileInfo.readOnly === true ? ' (read-only)' : ''}`,
      id,
      fileInfo.path,
    );
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
   * Follows a rename on disk: every open document backed by the renamed path — the file itself, or
   * any file beneath a renamed folder — is re-bound to where its file now lives, so its tab title,
   * its watch and the next save all target the new path rather than recreating the old one.
   *
   * The language is re-detected only when the file's extension changed: a folder rename, or a rename
   * that keeps the extension, must not undo a syntax the user chose by hand.
   * @param fromPath The absolute path the entry had before the rename.
   * @param toPath The absolute path it has now.
   * @returns Returns the ids of the documents that moved, so callers can sweep state keyed on the path.
   */
  public relocate(fromPath: string, toPath: string): readonly string[] {
    const moved: string[] = [];
    for (const [id, entry] of this.entries) {
      const current: string | null = entry.filePath();
      if (current === null) {
        continue;
      }
      const relocated: string | null = this.relocatePath(current, fromPath, toPath);
      if (relocated === null) {
        continue;
      }
      const extensionChanged: boolean = this.extname(current) !== this.extname(relocated);
      entry.filePath.set(relocated);
      entry.fileName.set(this.basename(relocated));
      if (extensionChanged) {
        this.redetectLanguage(id, entry);
      }
      this.syncTab(id);
      this.watchEntry(id);
      this.log.info('Documents', `Relocated '${entry.fileName()}'`, id, current, relocated);
      moved.push(id);
    }
    return moved;
  }

  /**
   * Maps a document's path through a rename: the renamed entry itself, or a descendant of a renamed
   * folder, lands under the new path; anything else is untouched. Descendants are matched on a
   * separator boundary, so renaming `/ws/src` leaves `/ws/src-old/a.ts` alone.
   * @param current The document's current path.
   * @param fromPath The renamed entry's old path.
   * @param toPath The renamed entry's new path.
   * @returns Returns the document's new path, or null when the rename does not touch it.
   */
  private relocatePath(current: string, fromPath: string, toPath: string): string | null {
    if (current === fromPath) {
      return toPath;
    }
    const separator: string = current.charAt(fromPath.length);
    if ((separator === '/' || separator === '\\') && current.startsWith(fromPath)) {
      return `${toPath}${current.slice(fromPath.length)}`;
    }
    return null;
  }

  /**
   * Records which document is currently focused for editing, so save commands target it. Passing
   * null clears the focus.
   * @param id The focused document id, or null.
   */
  public setActiveDocument(id: string | null): void {
    const previous: string | null = this.activeDocument();
    this.activeDocument.set(id);
    // Moving to another document, or away from every one, is a focus change for Auto Save.
    if (
      previous !== null &&
      previous !== id &&
      this.settings.get('textEditor.autoSave') === 'focus'
    ) {
      void this.autoSave(previous, false);
    }
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
   * Registers what readies a document open in an editor for saving.
   * @param id The document identifier.
   * @param preparer What readies it.
   * @returns Returns a function that removes it.
   */
  public registerSavePreparer(id: string, preparer: DocumentSavePreparer): () => void {
    this.savePreparers.set(id, preparer);
    return (): void => {
      if (this.savePreparers.get(id) === preparer) {
        this.savePreparers.delete(id);
      }
    };
  }

  /**
   * Saves a tab's document, prompting for a path when it has never been saved.
   * @param id The owning tab identifier.
   * @param whileTyping Whether the user may still be typing, so the text must stay as it is.
   * @returns Returns true when the document was saved.
   */
  public async save(id: string, whileTyping: boolean = false): Promise<boolean> {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined) {
      return false;
    }
    if (entry.readOnly()) {
      this.log.debug('Documents', `Not saving read-only '${entry.fileName()}'`, id);
      return false;
    }
    const filePath: string | null = entry.filePath();
    if (filePath === null) {
      return this.saveAs(id);
    }
    if (!whileTyping) {
      await this.prepareForSave(id, entry);
    }
    const content: string | null = await this.writeApplyingRules(entry, filePath, whileTyping);
    if (content !== null) {
      entry.original.set(content);
      this.syncTab(id);
      this.recordRecent(entry);
      this.log.info('Documents', `Saved '${entry.fileName()}'`, id, filePath);
    }
    return content !== null;
  }

  /**
   * Saves a tab's document to a newly chosen path, updating its file association and language.
   * @param id The owning tab identifier.
   * @returns Returns true when the document was saved.
   */
  public async saveAs(id: string): Promise<boolean> {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined || entry.readOnly()) {
      return false;
    }
    const suggested: string = entry.filePath() ?? this.suggestedFileName(entry);
    const targetPath: string | null = await this.fileSystem.saveDialog(suggested);
    if (targetPath === null) {
      return false;
    }
    // The new path may sit under a different `.editorconfig`, whose rules this write must follow.
    await this.refreshEditorConfig(id, targetPath);
    await this.prepareForSave(id, entry);
    const language: string = this.monaco.getLanguageForExtension(this.extname(targetPath));
    const hadBom: boolean = entry.hasBom();
    if (this.startsWithBom(entry, language)) {
      entry.hasBom.set(true);
    }
    const content: string | null = await this.writeApplyingRules(
      entry,
      targetPath,
      false,
      language,
    );
    const success: boolean = content !== null;
    if (content !== null) {
      entry.filePath.set(targetPath);
      entry.fileName.set(this.basename(targetPath));
      entry.language.set(language);
      entry.original.set(content);
      this.syncTab(id);
      this.watchEntry(id);
      this.recordRecent(entry);
      this.log.info('Documents', `Saved as '${entry.fileName()}'`, id, targetPath);
    } else {
      entry.hasBom.set(hadBom);
      await this.refreshEditorConfig(id);
      this.log.warn('Documents', 'Save-as failed', id, targetPath);
    }
    return success;
  }

  /**
   * Saves a document in another encoding: converts it and writes it in that one from now on. When the
   * text holds a character the encoding cannot, nothing is written and the document keeps its own.
   * @param id The owning tab identifier.
   * @param encoding The encoding to save in.
   * @returns Returns true when the document was saved.
   */
  public async saveWithEncoding(id: string, encoding: TextEncoding): Promise<boolean> {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined || entry.readOnly()) {
      return false;
    }
    const previous: { encoding: TextEncoding; hasBom: boolean } = {
      encoding: entry.encoding(),
      hasBom: entry.hasBom(),
    };
    entry.encoding.set(encoding);
    // UTF-16 is written with its byte-order mark, so it reads back as UTF-16; UTF-8 keeps the file's
    // choice; a single-byte encoding has none.
    entry.hasBom.set(
      encoding === 'utf8'
        ? previous.encoding === 'utf8' && previous.hasBom
        : encoding === 'utf16le' || encoding === 'utf16be',
    );
    this.log.info('Documents', `Saving '${entry.fileName()}' as ${encoding}`, id);
    if (await this.save(id)) {
      return true;
    }
    entry.encoding.set(previous.encoding);
    entry.hasBom.set(previous.hasBom);
    return false;
  }

  /**
   * Reopens a document's file decoded in an encoding, whatever its bytes suggest: for a file read in
   * the wrong one. Unsaved edits are given up, so a caller asks first.
   * @param id The owning tab identifier.
   * @param encoding The encoding to read it in.
   * @returns Returns true when the file was read again.
   */
  public async reopenWithEncoding(id: string, encoding: TextEncoding): Promise<boolean> {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    const filePath: string | null | undefined = entry?.filePath();
    if (entry === undefined || filePath === null || filePath === undefined) {
      return false;
    }
    const info: FileInfo | null = await this.fileSystem.read(filePath, encoding);
    if (info === null) {
      this.log.warn('Documents', `Could not reopen '${entry.fileName()}' as ${encoding}`, id);
      return false;
    }
    entry.encoding.set(info.encoding ?? encoding);
    entry.hasBom.set(info.hasBom ?? false);
    entry.content.set(info.content);
    entry.original.set(info.content);
    this.syncTab(id);
    this.log.info('Documents', `Reopened '${entry.fileName()}' as ${encoding}`, id);
    return true;
  }

  /**
   * Determines whether a document saved for the first time starts with a byte-order mark: Add
   * Byte-Order Mark to New Files, unless an `.editorconfig` decides its charset.
   * @param entry The document.
   * @param language The language it is being saved as.
   * @returns Returns true when the mark should be added.
   */
  private startsWithBom(entry: DocumentEntry, language: string): boolean {
    return (
      entry.filePath() === null &&
      entry.encoding() === 'utf8' &&
      entry.editorConfig()?.charset === undefined &&
      this.settings.resolveSettingsForLanguage(language).addByteOrderMark
    );
  }

  /**
   * Runs what the document's editor does before a save, when a setting asks for any of it. A save is
   * never lost to this: a formatter that fails or takes too long is logged, and the text saved as it
   * stands.
   * @param id The document identifier.
   * @param entry The document.
   * @returns Resolves once the document is ready, or the wait is over.
   */
  private async prepareForSave(id: string, entry: DocumentEntry): Promise<void> {
    const preparer: DocumentSavePreparer | undefined = this.savePreparers.get(id);
    const settings: TextEditorSettings = this.settings.resolveSettingsForLanguage(entry.language());
    if (
      preparer === undefined ||
      (settings.formatOnSave === 'off' && !settings.organiseImportsOnSave)
    ) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut: Promise<boolean> = new Promise<boolean>(
      (resolve: (value: boolean) => void): void => {
        timer = setTimeout((): void => resolve(true), SAVE_PREPARATION_TIMEOUT_MS);
      },
    );
    try {
      const finished: Promise<boolean> = preparer(settings, entry.original()).then(
        (): boolean => false,
      );
      if (await Promise.race([finished, timedOut])) {
        this.log.warn('Documents', `Saving '${entry.fileName()}' without waiting to format`, id);
      }
    } catch (error: unknown) {
      this.log.warn('Documents', `Could not format '${entry.fileName()}' on save`, id, error);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Gets the rules a document's text is saved under.
   * @param entry The document.
   * @param language The language it is saved as.
   * @param whileTyping Whether the user may still be typing.
   * @returns Returns the rules.
   */
  private saveRules(
    entry: DocumentEntry,
    language: string,
    whileTyping: boolean,
  ): DocumentSaveRules {
    const rules: DocumentSaveRules = resolveSaveRules(
      entry.editorConfig(),
      this.settings.resolveSettingsForLanguage(language),
    );
    return whileTyping ? saveRulesWhileTyping(rules) : rules;
  }

  /**
   * Writes a document's text with the save rules applied. A code editor shows what was written; a
   * Markdown document keeps its text, as replacing it would rebuild the editor under the caret, and
   * the file differing from it only in what the rules changed is not a change on disk.
   * @param entry The document.
   * @param path Where to write.
   * @param whileTyping Whether the user may still be typing.
   * @param language The language it is saved as.
   * @returns Returns the document's text as now saved, or null when it could not be written.
   */
  private async writeApplyingRules(
    entry: DocumentEntry,
    path: string,
    whileTyping: boolean,
    language: string = entry.language(),
  ): Promise<string | null> {
    const content: string = entry.content();
    const written: string = applySaveRules(content, this.saveRules(entry, language, whileTyping));
    const kept: string = entry.language() === 'markdown' ? content : written;
    entry.lastWritten = written === kept ? null : written;
    if (kept !== content) {
      entry.content.set(kept);
    }
    return (await this.write(entry, path, written)) ? kept : null;
  }

  /**
   * Writes a document's text in its encoding, saying why when it cannot be: a character the encoding
   * has no byte for is the failure a user can act on.
   * @param entry The document.
   * @param path Where to write.
   * @param content The text.
   * @returns Returns true when it was written.
   */
  private async write(entry: DocumentEntry, path: string, content: string): Promise<boolean> {
    const result: FileWriteResult = await this.fileSystem.write(
      path,
      content,
      entry.hasBom(),
      entry.encoding(),
    );
    if (!result.success) {
      this.log.warn('Documents', `Save failed for '${entry.fileName()}'`, path, result.error);
      this.notifications.notify({
        severity: 'error',
        title: `${entry.fileName()} wasn't saved`,
        detail: result.error ?? 'The file could not be written.',
      });
    }
    return result.success;
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
    // A new document starts in Default Language for New Documents; opening a file sets its own.
    const language: WritableSignal<string> = signal<string>(
      this.settings.get('textEditor.defaultLanguage'),
    );
    const content: WritableSignal<string> = signal<string>('');
    const original: WritableSignal<string> = signal<string>('');
    // And is saved in Default Encoding — a UTF-16 one with its byte-order mark, which tells the
    // encoding to whoever reads it next; opening a file sets its own.
    const defaultEncoding: TextEncoding = this.settings.get('textEditor.defaultEncoding');
    const encoding: WritableSignal<TextEncoding> = signal<TextEncoding>(defaultEncoding);
    const hasBom: WritableSignal<boolean> = signal<boolean>(defaultEncoding.startsWith('utf16'));
    const readOnly: WritableSignal<boolean> = signal<boolean>(false);
    const editorConfig: WritableSignal<EditorConfigProperties | null> =
      signal<EditorConfigProperties | null>(null);
    // A read-only document is never dirty, so it never asks to be saved on close or by Save All.
    const dirty: Signal<boolean> = computed((): boolean => !readOnly() && content() !== original());
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
      editorConfig: editorConfig.asReadonly(),
      readOnly: readOnly.asReadonly(),
      view: signal<CodeViewToggles>({}),
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
      readOnly,
      watchDisposer: null,
      editorConfigDisposer: null,
      editorConfig,
      encodingBeforeEditorConfig: null,
      lastWritten: null,
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
    void this.refreshEditorConfig(id);
  }

  /**
   * Asks EditorConfig about a document's file again, and keeps watching what decides the answer.
   * @param id The document identifier.
   * @param path The path to ask about; defaults to the document's own.
   * @returns Returns a promise that resolves once the answer is applied.
   */
  private async refreshEditorConfig(id: string, path?: string): Promise<void> {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    const filePath: string | null = path ?? entry?.filePath() ?? null;
    if (entry === undefined) {
      return;
    }
    const resolution: EditorConfigResolution | null =
      filePath === null ? null : await this.editorConfigs.resolve(filePath);
    if (this.entries.get(id) !== entry) {
      return;
    }
    entry.editorConfigDisposer?.();
    entry.editorConfigDisposer =
      resolution === null
        ? null
        : this.editorConfigs.watch(resolution.candidates, (): void => {
            void this.refreshEditorConfig(id);
          });
    const properties: EditorConfigProperties | null =
      resolution === null || Object.keys(resolution.properties).length === 0
        ? null
        : resolution.properties;
    entry.editorConfig.set(properties);
    this.applyEditorConfigCharset(entry, properties);
  }

  /**
   * Puts a document in the encoding its `.editorconfig` asks for, or back in its own when none does.
   * It takes effect on the next save. Markdown documents follow only the whitespace and newline
   * properties.
   * @param entry The document.
   * @param properties The properties in force.
   */
  private applyEditorConfigCharset(
    entry: DocumentEntry,
    properties: EditorConfigProperties | null,
  ): void {
    const charset: EditorConfigCharset | undefined =
      entry.language() === 'markdown' ? undefined : properties?.charset;
    if (charset !== undefined) {
      entry.encodingBeforeEditorConfig ??= { encoding: entry.encoding(), hasBom: entry.hasBom() };
      entry.encoding.set(CHARSET_ENCODINGS[charset]);
      entry.hasBom.set(charset === 'utf-8-bom' || charset.startsWith('utf-16'));
    } else if (entry.encodingBeforeEditorConfig !== null) {
      entry.encoding.set(entry.encodingBeforeEditorConfig.encoding);
      entry.hasBom.set(entry.encodingBeforeEditorConfig.hasBom);
      entry.encodingBeforeEditorConfig = null;
    }
  }

  /**
   * Handles a watched document's file changing on disk. With no unsaved edits it does what Reload
   * Files Changed on Disk says; when it is dirty, raises a keep/reload conflict for the user to resolve.
   * @param id The document identifier.
   * @param info The freshly-read file.
   */
  private onDiskChange(id: string, info: FileInfo): void {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    // The watcher tells the encoding from the bytes; a document reopened in another reads its file in
    // that one, or every change would look like new text.
    const encoding: TextEncoding = entry.encoding();
    if ((info.encoding ?? ASSUMED_ENCODING) !== encoding) {
      void this.fileSystem.read(info.path, encoding).then((reread: FileInfo | null): void => {
        if (reread !== null && reread.encoding === encoding) {
          this.onDiskChange(id, reread);
        }
      });
      return;
    }
    if (entry.content() === info.content || entry.lastWritten === info.content) {
      return;
    }
    if (!entry.document.dirty()) {
      this.fileConflicts.changedOnDisk(
        { documentId: id, tabId: this.owningTabId ?? id, name: entry.fileName() },
        (): void => this.reloadFromDisk(id, info.content),
      );
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
   * Reflects a document's file name and dirty state onto its owning tab. A well document has no
   * top-level tab; its dock panel is the tab, and only its title is reflected there — the panel's
   * dirty marker reads the document's own signal.
   * @param id The owning tab identifier.
   */
  private syncTab(id: string): void {
    const entry: DocumentEntry | undefined = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    const fileName: string = entry.fileName();
    const tab: Tab | undefined = this.tabs
      .tabs()
      .find((candidate: Tab): boolean => candidate.id === id);
    if (tab === undefined) {
      this.syncWellPanel(id, entry);
      return;
    }
    const dirty: boolean = entry.document.dirty();
    if (tab.title !== fileName) {
      this.tabs.rename(id, fileName);
    }
    if ((tab.dirty ?? false) !== dirty) {
      this.tabs.setDirty(id, dirty);
    }
  }

  /**
   * Reflects a well document's file name onto its dock panel's title. Leaves the registry alone when
   * the title already matches, since a patch re-runs every computed that resolves panels.
   * @param id The well document identifier.
   * @param entry The document's entry.
   */
  private syncWellPanel(id: string, entry: DocumentEntry): void {
    const panel: DockPanel | undefined = this.dockPanels.get(id);
    if (panel === undefined || panel.title === entry.fileName()) {
      return;
    }
    this.dockPanels.update(id, { title: entry.fileName() });
  }

  /**
   * Re-detects a document's language after its extension changed, and — for a well document — swaps
   * its dock panel's icon and tool-strip ownership to match: a rename across the markdown boundary
   * swaps the editor beneath the tab, so the tab must swap with it.
   * @param id The document identifier.
   * @param entry The document's entry, already re-pointed at its new path.
   */
  private redetectLanguage(id: string, entry: DocumentEntry): void {
    entry.language.set(this.monaco.getLanguageForFileName(entry.fileName()));
    if (this.dockPanels.get(id) === undefined) {
      return;
    }
    const markdown: boolean = entry.language() === 'markdown';
    this.dockPanels.update(id, {
      icon: markdown ? Icon.MARKDOWN : Icon.CODE,
    });
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
