import { MockInstance, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { WorkspaceChannel } from '@shared/api/workspace-channels';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { Tab } from '@shared/angular/services/tabs/tab';
import { ImageDocument, ImageDocuments } from '../image-document/image-document';
import { ImageRaster } from '../image-raster/image-raster';
import { ImageContext, ImageStatus } from '../image-status/image-status';
import { IMAGE_KEYBINDINGS } from '../image-keybindings';
import { ImageViews } from '../image-views/image-views';
import { FakeImageRaster } from '../testing/fake-image-raster';
import { ImageView } from './image-view';

/**
 * Exposes the protected members the template drives, so the view's behaviour can be exercised
 * directly.
 */
interface ImageViewInternals {
  onKeydown(event: KeyboardEvent): void;
  onResizeWidth(width: number): void;
  onResizeUnit(unit: string): void;
  onExportType(type: string): void;
  resizeHeight(): number;
  resizePercent: { set(value: number): void };
  resizeTarget(): { width: number; height: number };
  exportType(): string;
}

/**
 * Builds a fake transport answering the file-size read every image makes when it opens.
 * @returns Returns the fake bridge.
 */
function fakeBridge(): Bridge {
  return {
    invoke: <T>(channel: string): Promise<T> =>
      Promise.resolve(
        (channel === (WorkspaceChannel.ReadBytes as string)
          ? { size: 2048, offset: 0, bytes: new Uint8Array(1) }
          : null) as T,
      ),
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

/**
 * Builds a key event carrying the platform's primary modifier on either platform.
 * @param key The key pressed.
 * @returns Returns the event.
 */
function modKey(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, metaKey: true, ctrlKey: true, cancelable: true });
}

describe('ImageView', () => {
  let documents: ImageDocuments;
  let fixture: ComponentFixture<ImageView>;
  let view: ImageView;
  let tab: Tab;

  /**
   * Opens an image in a tab and mounts its view.
   * @param path The image's path.
   */
  async function mount(path: string): Promise<void> {
    tab = documents.openTab(path);
    await flush();
    fixture = TestBed.createComponent(ImageView);
    fixture.componentRef.setInput('tabId', tab.id);
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();
    await fixture.whenStable();
    view = fixture.componentInstance;
  }

  /**
   * Gets the view's internals.
   * @returns Returns the view as its internals.
   */
  function internals(): ImageViewInternals {
    return view as unknown as ImageViewInternals;
  }

  /**
   * Gets the document the view shows.
   * @returns Returns the document.
   */
  function document(): ImageDocument {
    return view.document()!;
  }

  beforeEach(async () => {
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    await TestBed.configureTestingModule({
      imports: [ImageView],
      providers: [
        { provide: ImageRaster, useValue: new FakeImageRaster() },
        provideKeybindingCatalogue(IMAGE_KEYBINDINGS),
      ],
    }).compileComponents();
    documents = TestBed.inject(ImageDocuments);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('mount_asATab_registersForTheRibbonAndPublishesItsStatus', async () => {
    await mount('/pictures/photo.png');

    expect(TestBed.inject(ImageViews).get(tab.id)).toBe(view);
    const context: ImageContext | null = fixture.debugElement.injector.get(ImageStatus).context();
    expect(context).toEqual({
      path: '/pictures/photo.png',
      format: 'PNG',
      dimensions: '40 × 30',
      fileSize: '2.0 KB',
      zoom: '100%',
      note: null,
      dirty: false,
    });
  });

  it('render_showsTheImageAtItsFittedSize', async () => {
    await mount('/pictures/photo.png');

    const image: HTMLImageElement = (fixture.nativeElement as HTMLElement).querySelector('img')!;
    expect(image.getAttribute('src')).toContain('studio-media://image/');
    const stage: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.image-view__stage',
    )!;
    expect(stage.style.width).toBe('40px');
    expect(stage.style.height).toBe('30px');
  });

  it('zoomCommands_stepFixAndReturnToFit', async () => {
    await mount('/pictures/photo.png');

    view.zoomIn();
    expect(view.scale()).toBe(1.25);
    expect(view.isFitted()).toBe(false);
    view.zoomOut();
    view.zoomOut();
    expect(view.scale()).toBe(0.75);
    view.actualSize();
    expect(view.zoomLabel()).toBe('100%');
    view.fit();
    expect(view.isFitted()).toBe(true);
  });

  it('keydown_zoomsWithTheCataloguedChordsAndSwallowsThem', async () => {
    await mount('/pictures/photo.png');

    const zoomIn: KeyboardEvent = modKey('=');
    internals().onKeydown(zoomIn);
    expect(view.scale()).toBe(1.25);
    expect(zoomIn.defaultPrevented).toBe(true);

    internals().onKeydown(modKey('+'));
    expect(view.scale()).toBe(1.5);

    internals().onKeydown(modKey('0'));
    expect(view.scale()).toBe(1);

    const unrelated: KeyboardEvent = modKey('k');
    internals().onKeydown(unrelated);
    expect(unrelated.defaultPrevented).toBe(false);
  });

  it('rotate_editsTheSharedDocument', async () => {
    await mount('/pictures/photo.png');

    view.rotate(true);
    await flush();

    expect(document().size()).toEqual({ width: 30, height: 40 });
    expect(document().dirty()).toBe(true);
  });

  it('crop_appliesTheDrawnRectangleAndClosesTheTool', async () => {
    await mount('/pictures/photo.png');

    view.toggleTool('crop');
    expect(view.tool()).toBe('crop');
    view.cropRect.set({ x: 5, y: 5, width: 10, height: 8 });
    view.applyCrop();
    await flush();

    expect(document().size()).toEqual({ width: 10, height: 8 });
    expect(view.tool()).toBe('none');
  });

  it('keydown_escapeClosesTheOpenTool', async () => {
    await mount('/pictures/photo.png');
    view.toggleTool('resize');

    internals().onKeydown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

    expect(view.tool()).toBe('none');
  });

  it('resize_keepsTheAspectRatioWhileLocked', async () => {
    await mount('/pictures/photo.png');
    view.toggleTool('resize');

    internals().onResizeWidth(20);
    expect(internals().resizeHeight()).toBe(15);

    internals().onResizeUnit('%');
    internals().resizePercent.set(50);
    expect(internals().resizeTarget()).toEqual({ width: 20, height: 15 });

    view.applyResize();
    await flush();
    expect(document().size()).toEqual({ width: 20, height: 15 });
  });

  it('editingTools_areRefusedForAnSvgButExportStaysAvailable', async () => {
    await mount('/art/logo.svg');

    view.toggleTool('crop');
    expect(view.tool()).toBe('none');
    expect(view.editingNote()).toBe('Vector image — export to edit as pixels');

    view.toggleTool('export');
    expect(view.tool()).toBe('export');
    expect(internals().exportType()).toBe('image/png');
    internals().onExportType('image/webp');
    expect(internals().exportType()).toBe('image/webp');
  });

  it('save_whenTheFormatCannotBeWrittenBack_opensTheExportTool', async () => {
    await mount('/pictures/anim.gif');
    expect(view.editingNote()).toBe('Editing flattens the animation');
    view.flip('horizontal');
    await flush();

    await view.save();

    expect(view.tool()).toBe('export');
    expect(document().dirty()).toBe(true);
  });

  it('openInBinaryEditor_andOpenSource_routeThroughTheFileOpener', async () => {
    await mount('/art/logo.svg');
    const opener: FileOpener = TestBed.inject(FileOpener);
    const binary: MockInstance = vi.spyOn(opener, 'openAsBinary').mockReturnValue(true);
    const text: MockInstance = vi.spyOn(opener, 'openAsText').mockResolvedValue(true);

    view.openInBinaryEditor();
    view.openSource();

    expect(binary).toHaveBeenCalledWith('/art/logo.svg');
    expect(text).toHaveBeenCalledWith('/art/logo.svg');
  });

  it('destroy_asATab_releasesItsDocument', async () => {
    await mount('/pictures/photo.png');

    fixture.destroy();

    expect(documents.forHolder(tab.id)).toBeUndefined();
    expect(TestBed.inject(ImageViews).get(tab.id)).toBeUndefined();
  });

  it('mount_inAWell_leavesRegistrationAndTheHoldToThePanel', async () => {
    documents.hold('panel-1', 'workspace-tab', '/ws/photo.png');
    await flush();
    fixture = TestBed.createComponent(ImageView);
    fixture.componentRef.setInput('tabId', 'panel-1');
    fixture.componentRef.setInput('host', 'well');
    fixture.detectChanges();

    expect(TestBed.inject(ImageViews).get('panel-1')).toBeUndefined();
    fixture.destroy();
    expect(documents.forHolder('panel-1')).toBeDefined();
  });
});
