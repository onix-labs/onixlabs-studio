import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { FileChannel, SaveDialogChoice } from '@shared/api/file-channels';
import { BinarySpan, WorkspaceChannel } from '@shared/api/workspace-channels';
import { FileConflicts } from '@shared/angular/services/file-conflicts/file-conflicts';
import { FileWatch } from '@shared/angular/services/file-watch/file-watch';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { UnsavedDocument } from '@shared/angular/services/unsaved-work/unsaved-work';
import { ImageRaster } from '../image-raster/image-raster';
import { FakeImageRaster } from '../testing/fake-image-raster';
import { ImageDocument, ImageDocuments, mediaUrl } from './image-document';

/**
 * Records each write made through the fake write-pieces channel.
 */
let writes: { path: string; spans: readonly BinarySpan[]; bytes: number }[];

/**
 * Holds what the fake confirm-save dialog answers.
 */
let confirmChoice: SaveDialogChoice;

/**
 * Holds what the fake save dialog answers.
 */
let savePath: string | null;

/**
 * Holds the paths the fake save dialog was offered as defaults.
 */
let saveDialogDefaults: string[];

/**
 * Holds the change callbacks registered with the fake file watch, by path.
 */
let watchers: Map<string, () => void>;

/**
 * Builds a fake transport for the channels image documents use: reading the file's size, writing it,
 * and the save and confirm-save dialogs.
 */
function fakeBridge(): Bridge {
  return {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
      if (channel === (WorkspaceChannel.ReadBytes as string)) {
        return Promise.resolve({ size: 4096, offset: 0, bytes: new Uint8Array(1) } as T);
      }
      if (channel === (WorkspaceChannel.WritePieces as string)) {
        const [path, spans, added] = args as [string, readonly BinarySpan[], Uint8Array];
        writes.push({ path, spans, bytes: added.length });
        return Promise.resolve(true as T);
      }
      if (channel === (FileChannel.ConfirmSave as string)) {
        return Promise.resolve(confirmChoice as T);
      }
      if (channel === (FileChannel.SaveFileDialog as string)) {
        saveDialogDefaults.push(args[0] as string);
        return Promise.resolve(savePath as T);
      }
      return Promise.resolve(null as T);
    },
    send: (): void => undefined,
    on: (): (() => void) => (): void => undefined,
  };
}

/**
 * Flushes pending promise continuations.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('ImageDocuments', () => {
  let documents: ImageDocuments;
  let raster: FakeImageRaster;
  let tabs: Tabs;

  beforeEach(() => {
    writes = [];
    confirmChoice = 'cancel';
    savePath = null;
    saveDialogDefaults = [];
    watchers = new Map<string, () => void>();
    raster = new FakeImageRaster();
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    TestBed.configureTestingModule({
      providers: [
        { provide: ImageRaster, useValue: raster },
        {
          provide: FileWatch,
          useValue: {
            watchPath: (path: string, onChange: () => void): (() => void) => {
              watchers.set(path, onChange);
              return (): void => void watchers.delete(path);
            },
          },
        },
      ],
    });
    documents = TestBed.inject(ImageDocuments);
    tabs = TestBed.inject(Tabs);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  /**
   * Opens an image in a tab and waits for it to load.
   * @param path The image's path.
   * @returns Returns the tab and its document.
   */
  async function openLoaded(path: string): Promise<{ tab: Tab; document: ImageDocument }> {
    const tab: Tab = documents.openTab(path);
    await flush();
    return { tab, document: documents.forHolder(tab.id)! };
  }

  it('openTab_opensAnImageTabTitledWithTheFileAndLoadsItsSize', async () => {
    const { tab, document } = await openLoaded('/pictures/photo.png');

    expect(tab.type).toBe('image');
    expect(tab.title).toBe('photo.png');
    expect(document.format).toBe('PNG');
    expect(document.size()).toEqual({ width: 40, height: 30 });
    expect(document.fileSize()).toBe(4096);
    expect(document.displayUrl()).toBe(mediaUrl('/pictures/photo.png', 0));
  });

  it('openTab_whenTheSamePathIsOpenedAgain_reusesTheTab', () => {
    const first: Tab = documents.openTab('/pictures/photo.png');
    const second: Tab = documents.openTab('/pictures/photo.png');

    expect(second.id).toBe(first.id);
    expect(tabs.tabs()).toHaveLength(1);
  });

  it('load_whenTheImageCannotBeDecoded_reportsTheError', async () => {
    raster.failDecode = true;
    const { document } = await openLoaded('/pictures/broken.png');

    expect(document.loadError()).toBe(true);
    expect(document.canEdit()).toBe(false);
  });

  it('apply_rotatesTheImageShowsTheEditAndMarksTheDocumentAndTabDirty', async () => {
    const { tab, document } = await openLoaded('/pictures/photo.png');

    expect(await document.apply({ kind: 'rotate', clockwise: true })).toBe(true);
    TestBed.tick();

    expect(document.size()).toEqual({ width: 30, height: 40 });
    expect(document.displayUrl()).toBe('blob:edited-1');
    expect(document.dirty()).toBe(true);
    expect(document.canUndo()).toBe(true);
    expect(tabs.get(tab.id)?.dirty).toBe(true);
  });

  it('undo_returnsToTheFileAndRedoReappliesTheEdit', async () => {
    const { document } = await openLoaded('/pictures/photo.png');
    await document.apply({ kind: 'crop', rect: { x: 0, y: 0, width: 10, height: 10 } });

    await document.undo();
    expect(document.dirty()).toBe(false);
    expect(document.size()).toEqual({ width: 40, height: 30 });
    expect(document.displayUrl()).toBe(mediaUrl('/pictures/photo.png', 0));
    expect(raster.revoked).toEqual(['blob:edited-1']);

    await document.redo();
    expect(document.dirty()).toBe(true);
    expect(document.size()).toEqual({ width: 10, height: 10 });
  });

  it('apply_onAnSvg_isRefused', async () => {
    const { document } = await openLoaded('/art/logo.svg');

    expect(document.isVector).toBe(true);
    expect(document.canEdit()).toBe(false);
    expect(await document.apply({ kind: 'flip', axis: 'horizontal' })).toBe(false);
    expect(document.dirty()).toBe(false);
  });

  it('save_writesTheEditsOverTheFileInItsOwnFormatAndReloadsIt', async () => {
    const { document } = await openLoaded('/pictures/photo.jpg');
    await document.apply({ kind: 'resize', width: 20, height: 15 });

    expect(await document.save()).toBe('saved');

    expect(raster.encoded).toEqual(['image/jpeg']);
    expect(writes).toEqual([
      { path: '/pictures/photo.jpg', spans: [{ source: 'added', start: 0, length: 5 }], bytes: 5 },
    ]);
    expect(document.dirty()).toBe(false);
    expect(document.revision()).toBe(1);
    expect(document.fileSize()).toBe(4096);
  });

  it('save_whenTheFormatCannotBeWrittenBack_asksForAnExport', async () => {
    const { document } = await openLoaded('/pictures/anim.gif');
    await document.apply({ kind: 'flip', axis: 'vertical' });

    expect(document.isAnimatable).toBe(true);
    expect(await document.save()).toBe('needs-export');
    expect(writes).toEqual([]);
    expect(document.dirty()).toBe(true);
  });

  it('saveById_whenTheFormatCannotBeWrittenBack_exportsAPngBesideIt', async () => {
    const { document } = await openLoaded('/pictures/anim.gif');
    await document.apply({ kind: 'flip', axis: 'vertical' });
    savePath = '/pictures/anim.png';

    expect(await documents.save('/pictures/anim.gif')).toBe(true);

    expect(saveDialogDefaults).toEqual(['/pictures/anim.png']);
    expect(raster.encoded).toEqual(['image/png']);
    expect(writes.map((write) => write.path)).toEqual(['/pictures/anim.png']);
  });

  it('exportInteractive_whenTheDialogIsCancelled_writesNothing', async () => {
    const { document } = await openLoaded('/pictures/photo.png');
    savePath = null;

    expect(
      await documents.exportInteractive(document, {
        type: 'image/webp',
        quality: 0.8,
        scalePercent: 100,
      }),
    ).toBe(false);
    expect(writes).toEqual([]);
  });

  it('exportTo_writesTheChosenFormatAtTheChosenScale', async () => {
    const { document } = await openLoaded('/art/logo.svg');

    expect(
      await document.exportTo('/art/logo.webp', {
        type: 'image/webp',
        quality: 0.8,
        scalePercent: 200,
      }),
    ).toBe(true);

    expect(raster.encoded).toEqual(['image/webp']);
    expect(writes.map((write) => write.path)).toEqual(['/art/logo.webp']);
  });

  it('hold_theSameFileInATabAndAWellIsOneDocument', async () => {
    const { document } = await openLoaded('/ws/photo.png');
    const held: ImageDocument = documents.hold('panel-1', 'workspace-tab', '/ws/photo.png');

    expect(held).toBe(document);
  });

  it('dirtyDocumentsFor_listsAnEditedImageOnlyForTheLastTabHoldingIt', async () => {
    const { tab, document } = await openLoaded('/ws/photo.png');
    documents.hold('panel-1', 'workspace-tab', '/ws/photo.png');
    await document.apply({ kind: 'rotate', clockwise: false });

    const unsaved: readonly UnsavedDocument[] = [{ id: '/ws/photo.png', name: 'photo.png' }];
    expect(documents.dirtyDocuments()).toEqual(unsaved);
    expect(documents.dirtyDocumentsFor(tab.id)).toEqual([]);
    expect(documents.dirtyDocumentsFor('workspace-tab')).toEqual([]);

    documents.release('workspace-tab');
    expect(documents.dirtyDocumentsFor(tab.id)).toEqual(unsaved);
  });

  it('confirmClose_whileAnotherHostShowsTheImage_closesWithoutPrompting', async () => {
    const { document } = await openLoaded('/ws/photo.png');
    documents.hold('panel-1', 'workspace-tab', '/ws/photo.png');
    await document.apply({ kind: 'rotate', clockwise: true });
    confirmChoice = 'cancel';

    expect(await documents.confirmClose('panel-1')).toBe(true);
  });

  it('confirmClose_forTheLastHostOfAnEditedImage_honoursTheChoice', async () => {
    documents.hold('panel-1', 'workspace-tab', '/ws/photo.png');
    await flush();
    const document: ImageDocument = documents.forHolder('panel-1')!;
    await document.apply({ kind: 'rotate', clockwise: true });

    confirmChoice = 'cancel';
    expect(await documents.confirmClose('panel-1')).toBe(false);

    confirmChoice = 'dontSave';
    expect(await documents.confirmClose('panel-1')).toBe(true);
    expect(writes).toEqual([]);

    confirmChoice = 'save';
    expect(await documents.confirmClose('panel-1')).toBe(true);
    expect(writes.map((write) => write.path)).toEqual(['/ws/photo.png']);
  });

  it('releaseHolder_disposesTheDocumentWithItsLastHolder', async () => {
    const { tab } = await openLoaded('/ws/photo.png');
    documents.hold('panel-1', 'workspace-tab', '/ws/photo.png');

    documents.releaseHolder(tab.id);
    expect(watchers.has('/ws/photo.png')).toBe(true);
    expect(documents.forHolder('panel-1')).toBeDefined();

    documents.releaseHolder('panel-1');
    expect(watchers.has('/ws/photo.png')).toBe(false);
    expect(documents.forHolder('panel-1')).toBeUndefined();
  });

  it('diskChange_onAnUneditedImage_reloadsIt', async () => {
    const { document } = await openLoaded('/ws/photo.png');

    watchers.get('/ws/photo.png')?.();
    await flush();

    expect(document.revision()).toBe(1);
    expect(document.displayUrl()).toBe(mediaUrl('/ws/photo.png', 1));
  });

  it('diskChange_onAnEditedImage_raisesAConflictInsteadOfDiscardingTheEdits', async () => {
    const { document } = await openLoaded('/ws/photo.png');
    await document.apply({ kind: 'rotate', clockwise: true });

    watchers.get('/ws/photo.png')?.();

    expect(document.revision()).toBe(0);
    expect(document.dirty()).toBe(true);
    expect(TestBed.inject(FileConflicts).activeConflict()?.documentId).toBe('/ws/photo.png');
  });

  it('diskChange_rightAfterItsOwnSave_isIgnored', async () => {
    const { document } = await openLoaded('/ws/photo.png');
    await document.apply({ kind: 'rotate', clockwise: true });
    await document.save();

    watchers.get('/ws/photo.png')?.();

    expect(document.revision()).toBe(1);
  });
});
