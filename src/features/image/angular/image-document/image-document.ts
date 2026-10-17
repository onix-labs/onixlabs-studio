import {
  computed,
  effect,
  EffectRef,
  inject,
  Injector,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import {
  EncodableImageType,
  imageExtensionOf,
  imageMimeTypeOf,
  isEncodableImageType,
} from '@shared/api/image-formats';
import { SaveDialogChoice } from '@shared/api/file-channels';
import { BinaryChunk, BinarySpan } from '@shared/api/workspace-channels';
import { FileConflicts } from '@shared/angular/services/file-conflicts/file-conflicts';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { FileWatch } from '@shared/angular/services/file-watch/file-watch';
import { Log } from '@shared/angular/services/log/log';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import {
  UnsavedDocument,
  UnsavedWorkSource,
} from '@shared/angular/services/unsaved-work/unsaved-work';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { ImageEdit, ImageSize, scaleByPercent } from '../image-geometry/image-geometry';
import { ImageRaster, Raster } from '../image-raster/image-raster';

/**
 * Specifies the window, in milliseconds, within which a file-watch notification after the document's
 * own save is treated as that save's echo rather than an external change.
 */
const SAVE_ECHO_WINDOW_MS: number = 2000;

/**
 * Specifies how many edits the undo history keeps. Each step holds a whole raster, so the history is
 * bounded rather than growing with every rotate.
 */
const MAX_UNDO: number = 20;

/**
 * Specifies the quality a lossy format is written back at when an edited image is saved in place.
 */
const SAVE_QUALITY: number = 0.92;

/**
 * Specifies the custom scheme the main process serves local images over.
 */
const MEDIA_SCHEME: string = 'studio-media';

/**
 * Maps the file extensions to the short format label the status strip shows.
 */
const FORMAT_LABELS: Readonly<Record<string, string>> = {
  '.png': 'PNG',
  '.apng': 'APNG',
  '.jpg': 'JPEG',
  '.jpeg': 'JPEG',
  '.gif': 'GIF',
  '.webp': 'WebP',
  '.avif': 'AVIF',
  '.bmp': 'BMP',
  '.ico': 'ICO',
  '.svg': 'SVG',
};

/**
 * Maps each encodable format to the extension an export in it is given.
 */
export const EXPORT_EXTENSIONS: Readonly<Record<EncodableImageType, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/**
 * Describes what saving an image in place did.
 *
 * - `saved` — the edits were written over the file (or there were none).
 * - `needs-export` — the format cannot be written back (GIF, BMP, ICO, AVIF), so the edits must be
 *   exported to a format that can.
 * - `failed` — the file could not be written.
 */
export type ImageSaveResult = 'saved' | 'needs-export' | 'failed';

/**
 * Describes how an interactive export ended: written, cancelled at the save dialog, or failed.
 */
export type ImageExportOutcome = 'exported' | 'cancelled' | 'failed';

/**
 * Describes how an image is exported.
 */
export interface ImageExportOptions {
  /**
   * Gets the format to write.
   */
  readonly type: EncodableImageType;

  /**
   * Gets the quality from 0 to 1, for the lossy formats.
   */
  readonly quality: number;

  /**
   * Gets the scale to export at, as a percentage of the image's current size (100 is unchanged). An
   * SVG is rasterised at this scale of its intrinsic size.
   */
  readonly scalePercent: number;
}

/**
 * Represents one open image: the file it is bound to, its decoded size, and — once edited — the
 * edited raster and its undo history. Edits never touch the file until it is saved or exported.
 */
export class ImageDocument {
  /**
   * Gets the image's MIME type, from its extension.
   */
  public readonly mime: string;

  /**
   * Gets the short format label shown on the status strip (for example "PNG").
   */
  public readonly format: string;

  /**
   * Gets a value indicating whether the image is an SVG. Raster edits and in-place saves are disabled
   * for one — its source is text, edited as such — so only export applies.
   */
  public readonly isVector: boolean;

  /**
   * Gets a value indicating whether the format can hold an animation. Editing one flattens it to the
   * frame on screen, and the viewer says so.
   */
  public readonly isAnimatable: boolean;

  /**
   * Gets a value indicating whether edits can be written back in the image's own format.
   */
  public readonly canSaveInPlace: boolean;

  /**
   * Gets the file's revision, bumped whenever the file is reloaded so its URL changes and the
   * browser fetches it afresh rather than showing its cached copy.
   */
  public readonly revision: WritableSignal<number> = signal<number>(0);

  /**
   * Gets the URL the unedited file is shown from.
   */
  public readonly sourceUrl: Signal<string> = computed((): string =>
    mediaUrl(this.path, this.revision()),
  );

  /**
   * Gets the object URL of the edited raster, or null when the image is unedited.
   */
  public readonly editedUrl: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the URL the image is shown from: the edited raster when there is one, else the file.
   */
  public readonly displayUrl: Signal<string> = computed(
    (): string => this.editedUrl() ?? this.sourceUrl(),
  );

  /**
   * Gets the image's current size in pixels — the edited raster's once edited — or null until the
   * file has been decoded.
   */
  public readonly size: WritableSignal<ImageSize | null> = signal<ImageSize | null>(null);

  /**
   * Gets the file's size on disk in bytes, or null until it is known.
   */
  public readonly fileSize: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Gets a value indicating whether the file could not be decoded.
   */
  public readonly loadError: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether the image has edits that are not yet on disk.
   */
  public readonly dirty: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether there is an edit to undo.
   */
  public readonly canUndo: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether there is an undone edit to redo.
   */
  public readonly canRedo: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether an edit, save or export is in progress. The edit commands are
   * refused meanwhile, so two edits never race to build on the same raster.
   */
  public readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether the raster edits (rotate, flip, crop, resize) apply: the image is
   * decoded, is not a vector, and nothing else is in progress.
   */
  public readonly canEdit: Signal<boolean> = computed(
    (): boolean => !this.isVector && this.size() !== null && !this.busy(),
  );

  /**
   * Holds the decoded file for the current revision, or null until it is needed.
   */
  private original: Raster | null = null;

  /**
   * Holds the edited raster, or null when the image is unedited.
   */
  private edited: Raster | null = null;

  /**
   * Holds the rasters to return to on undo (null standing for the unedited file).
   */
  private undoStack: (Raster | null)[] = [];

  /**
   * Holds the rasters to return to on redo.
   */
  private redoStack: (Raster | null)[] = [];

  /**
   * Holds when the document last wrote its own file, to tell a save's watch echo from an external
   * change.
   */
  private lastSavedAt: number = 0;

  /**
   * Initializes a new instance of the {@link ImageDocument} class.
   * @param path The absolute path of the image file.
   * @param fileName The file's base name.
   * @param raster The raster service that decodes, edits and encodes pixels.
   * @param workspace The workspace client the file's bytes are read and written through.
   */
  public constructor(
    public readonly path: string,
    public readonly fileName: string,
    private readonly raster: ImageRaster,
    private readonly workspace: Workspace,
  ) {
    const extension: string = imageExtensionOf(path);
    this.mime = imageMimeTypeOf(path) ?? 'application/octet-stream';
    this.format = FORMAT_LABELS[extension] ?? extension.slice(1).toUpperCase();
    this.isVector = extension === '.svg';
    this.isAnimatable = extension === '.gif' || extension === '.apng';
    this.canSaveInPlace = isEncodableImageType(this.mime);
  }

  /**
   * Loads the file's size and decodes it to learn its pixel size. Called when the document opens and
   * again whenever the file is reloaded.
   * @returns Returns a promise that resolves once the load has settled either way.
   */
  public async load(): Promise<void> {
    const revision: number = this.revision();
    const chunk: BinaryChunk | null = await this.workspace.readBytes(this.path, 0, 1);
    if (chunk !== null) {
      this.fileSize.set(chunk.size);
    }
    try {
      const decoded: Raster = await this.raster.decode(this.sourceUrl());
      if (revision !== this.revision()) {
        return;
      }
      this.original = decoded;
      this.loadError.set(false);
      if (this.edited === null) {
        this.size.set(decoded.size);
      }
    } catch {
      if (revision === this.revision()) {
        this.loadError.set(true);
      }
    }
  }

  /**
   * Applies a raster edit on top of the current image. Refused for a vector, before the image has
   * decoded, and while another edit is in progress.
   * @param edit The edit to apply.
   * @returns Returns true when the edit was applied.
   */
  public async apply(edit: ImageEdit): Promise<boolean> {
    if (!this.canEdit()) {
      return false;
    }
    this.busy.set(true);
    try {
      const base: Raster = this.edited ?? (await this.decoded());
      const next: Raster = this.raster.apply(base, edit);
      this.undoStack.push(this.edited);
      if (this.undoStack.length > MAX_UNDO) {
        this.undoStack.shift();
      }
      this.redoStack = [];
      await this.show(next);
      return true;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Returns to the image before the most recent edit.
   * @returns Returns a promise that resolves once the image is shown.
   */
  public async undo(): Promise<void> {
    if (this.undoStack.length === 0 || this.busy()) {
      return;
    }
    this.redoStack.push(this.edited);
    await this.show(this.undoStack.pop() ?? null);
  }

  /**
   * Re-applies the most recently undone edit.
   * @returns Returns a promise that resolves once the image is shown.
   */
  public async redo(): Promise<void> {
    if (this.redoStack.length === 0 || this.busy()) {
      return;
    }
    this.undoStack.push(this.edited);
    await this.show(this.redoStack.pop() ?? null);
  }

  /**
   * Writes the edits over the file in the image's own format, then reloads it so what is shown is
   * what was written (a JPEG shows its re-encoding).
   * @returns Returns what the save did.
   */
  public async save(): Promise<ImageSaveResult> {
    if (!this.dirty() || this.edited === null) {
      return 'saved';
    }
    if (!this.canSaveInPlace || !isEncodableImageType(this.mime)) {
      return 'needs-export';
    }
    const written: boolean = await this.write(this.path, this.edited, this.mime, SAVE_QUALITY);
    if (!written) {
      return 'failed';
    }
    this.discardEdits();
    this.revision.update((revision: number): number => revision + 1);
    await this.load();
    return 'saved';
  }

  /**
   * Writes the image — edited or not — to a file in the chosen format. Exporting over the image's own
   * file counts as saving it.
   * @param path The absolute path to write to.
   * @param options The format, quality and scale to export at.
   * @returns Returns true when the file was written.
   */
  public async exportTo(path: string, options: ImageExportOptions): Promise<boolean> {
    if (this.busy()) {
      return false;
    }
    this.busy.set(true);
    let written: boolean;
    try {
      const source: Raster = this.edited ?? (await this.decoded());
      const raster: Raster =
        options.scalePercent === 100
          ? source
          : this.raster.draw(source, scaleByPercent(source.size, options.scalePercent));
      written = await this.write(path, raster, options.type, options.quality);
    } catch {
      written = false;
    } finally {
      this.busy.set(false);
    }
    if (written && path === this.path) {
      this.discardEdits();
      this.revision.update((revision: number): number => revision + 1);
      await this.load();
    }
    return written;
  }

  /**
   * Discards any edits and re-reads the file, after it changed on disk.
   * @returns Returns a promise that resolves once the reload has settled.
   */
  public async reload(): Promise<void> {
    this.discardEdits();
    this.original = null;
    this.revision.update((revision: number): number => revision + 1);
    await this.load();
  }

  /**
   * Determines whether the document wrote its own file within a window, so the watch echo of its own
   * save can be told apart from an external change.
   * @param withinMs The window, in milliseconds.
   * @returns Returns true when the document saved within the window.
   */
  public recentlySaved(withinMs: number): boolean {
    return Date.now() - this.lastSavedAt < withinMs;
  }

  /**
   * Releases the object URL of the edited raster.
   */
  public dispose(): void {
    this.replaceEditedUrl(null);
  }

  /**
   * Gets the decoded file, decoding it when it has not been yet.
   * @returns Returns the decoded file.
   */
  private async decoded(): Promise<Raster> {
    this.original ??= await this.raster.decode(this.sourceUrl());
    return this.original;
  }

  /**
   * Shows a raster as the current image (null for the unedited file), updating the size, dirty flag
   * and history state to match.
   * @param raster The raster to show, or null for the file itself.
   * @returns Returns a promise that resolves once its URL is ready.
   */
  private async show(raster: Raster | null): Promise<void> {
    this.edited = raster;
    this.replaceEditedUrl(raster === null ? null : await this.raster.objectUrl(raster));
    this.size.set(raster?.size ?? this.original?.size ?? this.size());
    this.dirty.set(raster !== null);
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
  }

  /**
   * Drops the edits and their history, showing the file again.
   */
  private discardEdits(): void {
    this.edited = null;
    this.undoStack = [];
    this.redoStack = [];
    this.replaceEditedUrl(null);
    this.dirty.set(false);
    this.canUndo.set(false);
    this.canRedo.set(false);
  }

  /**
   * Replaces the edited raster's object URL, revoking the one it replaces.
   * @param url The new URL, or null for none.
   */
  private replaceEditedUrl(url: string | null): void {
    const previous: string | null = this.editedUrl();
    if (previous !== null && previous !== url) {
      this.raster.revoke(previous);
    }
    this.editedUrl.set(url);
  }

  /**
   * Encodes a raster and writes it to a file through the workspace's write channel, as one span of
   * added bytes (so the file is created when it does not exist).
   * @param path The absolute path to write.
   * @param raster The raster to encode.
   * @param type The format to encode it in.
   * @param quality The lossy quality.
   * @returns Returns true when the file was written.
   */
  private async write(
    path: string,
    raster: Raster,
    type: EncodableImageType,
    quality: number,
  ): Promise<boolean> {
    const bytes: Uint8Array = await this.raster.encode(raster, type, quality);
    const spans: readonly BinarySpan[] = [{ source: 'added', start: 0, length: bytes.length }];
    const written: boolean = await this.workspace.writePieces(path, spans, bytes);
    if (written && path === this.path) {
      this.lastSavedAt = Date.now();
      this.fileSize.set(bytes.length);
    }
    return written;
  }
}

/**
 * Builds the `studio-media://` URL a file is shown from. The revision rides in its own query
 * parameter, which the protocol ignores, so a reload changes the URL without changing the file.
 * @param path The absolute path of the image.
 * @param revision The file's revision.
 * @returns Returns the URL.
 */
export function mediaUrl(path: string, revision: number): string {
  return `${MEDIA_SCHEME}://image/?src=${encodeURIComponent(path)}&v=${revision}`;
}

/**
 * Describes one host showing a document: a top-level image tab, or a panel in a workspace's well.
 */
interface ImageHolder {
  /**
   * Gets the holder's identifier — the tab id for a tab, the panel id for a well panel.
   */
  readonly id: string;

  /**
   * Gets the id of the top-level tab the holder lives in — the image tab itself, or the workspace tab
   * whose well holds the panel. Closing that tab releases the holder.
   */
  readonly tabId: string;

  /**
   * Gets the document the holder shows.
   */
  readonly document: ImageDocument;
}

/**
 * Represents the registry of open images, shared by both hosts: the same file opened as a tab and in
 * a workspace's well is one document, so an edit made in one shows in the other and saving it once
 * saves it for both. A document lives while anything holds it and is disposed with its last holder.
 * It is also the unsaved-work source the lifecycle and the tab closer walk, so an edited image
 * prompts before its last host closes and before the window quits.
 */
@Service()
export class ImageDocuments implements UnsavedWorkSource {
  /**
   * Holds the tab registry image tabs are opened in.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the workspace client documents read and write their bytes through.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the raster service documents decode, edit and encode through.
   */
  private readonly raster: ImageRaster = inject(ImageRaster);

  /**
   * Holds the file-system service showing the save and confirm-save dialogs.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the file-watch service each document's file is subscribed to.
   */
  private readonly fileWatch: FileWatch = inject(FileWatch);

  /**
   * Holds the file-conflict registry an edited document's external change is raised on.
   */
  private readonly fileConflicts: FileConflicts = inject(FileConflicts);

  /**
   * Holds the injector each image tab's dirty-marker effect is created in.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the open documents, keyed by path.
   */
  private readonly documents: Map<string, ImageDocument> = new Map<string, ImageDocument>();

  /**
   * Holds the hosts showing a document, keyed by holder id.
   */
  private readonly holders: Map<string, ImageHolder> = new Map<string, ImageHolder>();

  /**
   * Holds each document's file-watch disposer, keyed by path.
   */
  private readonly watchDisposers: Map<string, () => void> = new Map<string, () => void>();

  /**
   * Holds each image tab's dirty-marker effect, keyed by tab id.
   */
  private readonly dirtyEffects: Map<string, EffectRef> = new Map<string, EffectRef>();

  /**
   * Opens an image in a top-level image tab, reusing an existing tab for the same path.
   * @param path The absolute path of the image.
   * @returns Returns the opened, or re-activated, tab.
   */
  public openTab(path: string): Tab {
    const tab: Tab = this.tabs.open('image', path);
    if (!this.holders.has(tab.id)) {
      const document: ImageDocument = this.hold(tab.id, tab.id, path);
      this.tabs.rename(tab.id, document.fileName);
      // Mirror the document's dirty flag onto its tab, as edited code and binary tabs show theirs.
      this.dirtyEffects.set(
        tab.id,
        effect((): void => this.tabs.setDirty(tab.id, document.dirty()), {
          injector: this.injector,
        }),
      );
    }
    this.tabs.activate(tab.id);
    return this.tabs.get(tab.id) ?? tab;
  }

  /**
   * Holds an image's document for a host, opening the document when nothing holds it yet. Holding
   * again under the same id is a no-op.
   * @param holderId The host's identifier.
   * @param tabId The top-level tab the host lives in.
   * @param path The absolute path of the image.
   * @returns Returns the held document.
   */
  public hold(holderId: string, tabId: string, path: string): ImageDocument {
    const existing: ImageHolder | undefined = this.holders.get(holderId);
    if (existing !== undefined) {
      return existing.document;
    }
    const document: ImageDocument = this.documents.get(path) ?? this.openDocument(path);
    this.holders.set(holderId, { id: holderId, tabId, document });
    return document;
  }

  /**
   * Gets the document a host shows.
   * @param holderId The host's identifier.
   * @returns Returns the document, or undefined when the host holds none.
   */
  public forHolder(holderId: string): ImageDocument | undefined {
    return this.holders.get(holderId)?.document;
  }

  /**
   * Releases one host's hold on its document, disposing the document when it was the last.
   * @param holderId The host's identifier.
   */
  public releaseHolder(holderId: string): void {
    const holder: ImageHolder | undefined = this.holders.get(holderId);
    if (holder === undefined) {
      return;
    }
    this.holders.delete(holderId);
    this.dirtyEffects.get(holderId)?.destroy();
    this.dirtyEffects.delete(holderId);
    if (!this.isHeld(holder.document)) {
      this.closeDocument(holder.document);
    }
  }

  /**
   * Resolves a host's unsaved edits before it closes. Only the last host of an edited document
   * prompts: while another tab or well still shows the image, closing this one loses nothing.
   * @param holderId The closing host's identifier.
   * @returns Returns true when the host may close; false when the user cancelled.
   */
  public async confirmClose(holderId: string): Promise<boolean> {
    const document: ImageDocument | undefined = this.forHolder(holderId);
    if (document === undefined || !document.dirty() || this.holdersOf(document).length > 1) {
      return true;
    }
    const choice: SaveDialogChoice = await this.fileSystem.confirmSave(document.fileName);
    if (choice === 'cancel') {
      return false;
    }
    return choice === 'save' ? this.save(document.path) : true;
  }

  /**
   * Asks where to export an image, then exports it there.
   * @param document The document to export.
   * @param options The format, quality and scale to export at.
   * @returns Returns how the export ended, so a cancelled dialog is not reported as a failure.
   */
  public async exportInteractive(
    document: ImageDocument,
    options: ImageExportOptions,
  ): Promise<ImageExportOutcome> {
    const target: string | null = await this.fileSystem.saveDialog(
      withExtension(document.path, EXPORT_EXTENSIONS[options.type]),
    );
    if (target === null) {
      return 'cancelled';
    }
    if (await document.exportTo(target, options)) {
      this.log.info('image.document', `Exported ${document.fileName}`, target);
      return 'exported';
    }
    this.log.error('image.document', `Failed to export ${document.fileName}`, target);
    return 'failed';
  }

  /**
   * Lists the images with unsaved edits. Part of the unsaved-work contract the lifecycle walks before
   * the window closes.
   * @returns Returns each edited image's path (its id here) and file name.
   */
  public dirtyDocuments(): readonly UnsavedDocument[] {
    return [...this.documents.values()]
      .filter((document: ImageDocument): boolean => document.dirty())
      .map((document: ImageDocument): UnsavedDocument => ({
        id: document.path,
        name: document.fileName,
      }));
  }

  /**
   * Lists the edited images that closing a tab would lose: those every host of which lives in the
   * tab. An image also open in another tab is not lost by closing this one.
   * @param tabId The closing tab's identifier.
   * @returns Returns the edited images the tab is the last to hold.
   */
  public dirtyDocumentsFor(tabId: string): readonly UnsavedDocument[] {
    return this.dirtyDocuments().filter((unsaved: UnsavedDocument): boolean => {
      const document: ImageDocument | undefined = this.documents.get(unsaved.id);
      return (
        document !== undefined &&
        this.holdersOf(document).every((holder: ImageHolder): boolean => holder.tabId === tabId)
      );
    });
  }

  /**
   * Saves an image's edits. A format that cannot be written back is exported as PNG beside it
   * instead, through the save dialog, so the edits are kept either way.
   * @param id The image's path.
   * @returns Returns true when the edits were written; false when the write failed or was cancelled.
   */
  public async save(id: string): Promise<boolean> {
    const document: ImageDocument | undefined = this.documents.get(id);
    if (document === undefined) {
      return true;
    }
    let result: ImageSaveResult;
    try {
      result = await document.save();
    } catch (error: unknown) {
      // Encoding the edited canvas can throw; a save that could not happen is a failed save.
      this.log.error('image.document', 'Failed to encode image for saving', document.path, error);
      return false;
    }
    if (result === 'needs-export') {
      const outcome: ImageExportOutcome = await this.exportInteractive(document, {
        type: 'image/png',
        quality: 1,
        scalePercent: 100,
      });
      return outcome === 'exported';
    }
    if (result === 'failed') {
      this.log.error('image.document', 'Failed to save image', document.path);
      return false;
    }
    this.log.info('image.document', 'Saved image', document.path);
    return true;
  }

  /**
   * Releases every host that lives in a closing tab. Part of the unsaved-work contract the tab closer
   * calls once the tab's unsaved work is resolved.
   * @param tabId The closing tab's identifier.
   */
  public release(tabId: string): void {
    for (const holder of [...this.holders.values()]) {
      if (holder.tabId === tabId) {
        this.releaseHolder(holder.id);
      }
    }
  }

  /**
   * Opens a document for a path, watching its file and starting its load.
   * @param path The absolute path of the image.
   * @returns Returns the new document.
   */
  private openDocument(path: string): ImageDocument {
    this.log.info('image.document', 'Opening image', path);
    const document: ImageDocument = new ImageDocument(
      path,
      basename(path),
      this.raster,
      this.workspace,
    );
    this.documents.set(path, document);
    this.watchDisposers.set(
      path,
      this.fileWatch.watchPath(path, (): void => this.onDiskChange(document)),
    );
    void document.load();
    return document;
  }

  /**
   * Closes a document nothing holds any more.
   * @param document The document to close.
   */
  private closeDocument(document: ImageDocument): void {
    this.log.debug('image.document', 'Closing image', document.path);
    this.watchDisposers.get(document.path)?.();
    this.watchDisposers.delete(document.path);
    this.fileConflicts.clear(document.path);
    document.dispose();
    this.documents.delete(document.path);
  }

  /**
   * Handles a document's file changing on disk. The echo of its own save is ignored; an unedited
   * image reloads in place; an edited one raises a keep-or-reload conflict, so edits are never
   * silently discarded.
   * @param document The document whose file changed.
   */
  private onDiskChange(document: ImageDocument): void {
    if (document.recentlySaved(SAVE_ECHO_WINDOW_MS)) {
      return;
    }
    if (!document.dirty()) {
      this.log.info('image.document', 'External change; reloading image', document.path);
      void document.reload();
      return;
    }
    const tabId: string = this.holdersOf(document)[0]?.tabId ?? '';
    this.log.warn('image.document', 'External change on edited image', document.path);
    this.fileConflicts.raise(
      { documentId: document.path, tabId, name: document.fileName },
      {
        keep: (): void => undefined,
        reload: (): void => void document.reload(),
      },
    );
  }

  /**
   * Determines whether anything still holds a document.
   * @param document The document.
   * @returns Returns true when at least one host holds it.
   */
  private isHeld(document: ImageDocument): boolean {
    return this.holdersOf(document).length > 0;
  }

  /**
   * Lists the hosts holding a document.
   * @param document The document.
   * @returns Returns its holders.
   */
  private holdersOf(document: ImageDocument): readonly ImageHolder[] {
    return [...this.holders.values()].filter(
      (holder: ImageHolder): boolean => holder.document === document,
    );
  }
}

/**
 * Extracts the base name from an absolute path, handling both separators.
 * @param path The absolute path.
 * @returns Returns the file's base name.
 */
function basename(path: string): string {
  const parts: string[] = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Replaces a path's extension.
 * @param path The path.
 * @param extension The new extension, including the leading dot.
 * @returns Returns the path with the new extension.
 */
function withExtension(path: string, extension: string): string {
  const current: string = imageExtensionOf(path);
  return current.length === 0
    ? `${path}${extension}`
    : `${path.slice(0, -current.length)}${extension}`;
}
