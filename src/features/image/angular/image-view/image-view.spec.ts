import { Settings } from '@shared/angular/services/settings/settings';
import { MockInstance, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { WorkspaceChannel } from '@shared/api/workspace-channels';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Notifications } from '@shared/angular/services/notifications/notifications';
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
  onResizeHeight(height: number): void;
  onResizeResampling(resampling: string): void;
  resizeWidth(): number;
  exportIsLossy(): boolean;
  exportSize(): { width: number; height: number } | null;
  exportScale: { set(value: number): void };
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
  let raster: FakeImageRaster;

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
    raster = new FakeImageRaster();
    await TestBed.configureTestingModule({
      imports: [ImageView],
      providers: [
        { provide: ImageRaster, useValue: raster },
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

  it('rotate_whenTheEditFails_reportsItRatherThanDoingNothing', async () => {
    await mount('/pictures/photo.png');
    vi.spyOn(raster, 'objectUrl').mockRejectedValue(
      new Error('Tainted canvases may not be exported.'),
    );

    view.rotate(true);
    await flush();

    expect(document().dirty()).toBe(false);
    expect(TestBed.inject(Notifications).history()[0]).toMatchObject({
      severity: 'error',
      title: 'Could not edit photo.png',
      detail: 'Tainted canvases may not be exported.',
    });
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

  it('save_whenTheFormatCannotBeWrittenBackAndTheSettingAsks_opensTheExportTool', async () => {
    await mount('/pictures/anim.gif');
    expect(view.editingNote()).toBe('Editing flattens the animation');
    view.flip('horizontal');
    await flush();

    TestBed.inject(Settings).set('imageViewer.fallbackSaveFormat', 'ask');
    localStorage.removeItem('settings');
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

  /**
   * Gets the image's viewport.
   * @returns Returns the element.
   */
  function viewport(): HTMLElement {
    const element: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '[tabindex], .image-view__viewport',
    );
    if (element === null) {
      throw new Error('The viewport did not render');
    }
    return element;
  }

  /**
   * Raises a pointer event on the viewport.
   * @param type The event type.
   * @param init Where, and with which button and pointer.
   * @returns Returns the event.
   */
  function pointer(
    type: string,
    init: { clientX?: number; clientY?: number; button?: number; pointerId?: number } = {},
  ): MouseEvent {
    const event: MouseEvent = new MouseEvent(type, { cancelable: true, bubbles: true, ...init });
    Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
    viewport().dispatchEvent(event);
    return event;
  }

  /**
   * Reads what the user was told went wrong.
   * @returns Returns the titles, newest first.
   */
  function failures(): readonly string[] {
    return TestBed.inject(Notifications)
      .history()
      .map((note: { title: string }): string => note.title);
  }

  describe('dragging', () => {
    it('pan_scrollsTheViewportWithThePointer', async () => {
      await mount('/pictures/photo.png');
      viewport().scrollLeft = 50;
      viewport().scrollTop = 40;

      const down: MouseEvent = pointer('pointerdown', { clientX: 100, clientY: 100 });
      pointer('pointermove', { clientX: 80, clientY: 90 });

      expect(down.defaultPrevented).toBe(true);
      expect(viewport().scrollLeft).toBe(70);
      expect(viewport().scrollTop).toBe(50);
    });

    it('pan_stopsAtPointerUp', async () => {
      await mount('/pictures/photo.png');
      pointer('pointerdown', { clientX: 100, clientY: 100 });
      pointer('pointerup');

      pointer('pointermove', { clientX: 10, clientY: 10 });

      expect(viewport().scrollLeft).toBe(0);
    });

    it('ignoresASecondPointer', async () => {
      await mount('/pictures/photo.png');
      pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });

      pointer('pointermove', { clientX: 10, clientY: 10, pointerId: 2 });
      pointer('pointerup', { pointerId: 2 });
      pointer('pointermove', { clientX: 90, clientY: 100, pointerId: 1 });

      expect(viewport().scrollLeft).toBe(10);
    });

    it('ignoresTheRightButton', async () => {
      await mount('/pictures/photo.png');

      const down: MouseEvent = pointer('pointerdown', { button: 2 });

      expect(down.defaultPrevented).toBe(false);
    });

    it('crop_drawsARectangleInImagePixels', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('crop');
      fixture.detectChanges();
      view.actualSize();
      fixture.detectChanges();

      pointer('pointerdown', { clientX: 5, clientY: 4 });
      expect(view.cropRect()).toBeNull();
      pointer('pointermove', { clientX: 15, clientY: 12 });

      expect(view.cropRect()).toEqual({ x: 5, y: 4, width: 10, height: 8 });
    });
  });

  describe('the wheel', () => {
    /**
     * Turns the wheel over the viewport.
     * @param init The turn.
     * @returns Returns the event.
     */
    function wheel(init: WheelEventInit): WheelEvent {
      const event: WheelEvent = new WheelEvent('wheel', { cancelable: true, ...init });
      viewport().dispatchEvent(event);
      return event;
    }

    it('zooms_withTheCommandKeyHeld', async () => {
      await mount('/pictures/photo.png');
      view.actualSize();

      const turned: WheelEvent = wheel({ deltaY: -100, ctrlKey: true });

      expect(turned.defaultPrevented).toBe(true);
      expect(view.scale()).toBeGreaterThan(1);
    });

    it('scrolls_withNoKeyHeld', async () => {
      await mount('/pictures/photo.png');
      view.actualSize();

      const turned: WheelEvent = wheel({ deltaY: -100 });

      expect(turned.defaultPrevented).toBe(false);
      expect(view.scale()).toBe(1);
    });

    it('zooms_whenMouseWheelSaysZoom', async () => {
      TestBed.inject(Settings).set('imageViewer.mouseWheel', 'zoom');
      await mount('/pictures/photo.png');
      view.actualSize();

      wheel({ deltaY: 100 });
      localStorage.removeItem('settings');

      expect(view.scale()).toBeLessThan(1);
    });
  });

  describe('the crop tool', () => {
    it('applyCrop_ofTheWholeImage_changesNothing', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('crop');
      view.cropRect.set({ x: 0, y: 0, width: 40, height: 30 });

      view.applyCrop();
      await flush();

      expect(document().dirty()).toBe(false);
      expect(view.tool()).toBe('crop');
    });

    it('applyCrop_withNothingDrawn_changesNothing', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('crop');

      view.applyCrop();
      await flush();

      expect(document().dirty()).toBe(false);
    });

    it('enter_appliesTheCrop', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('crop');
      view.cropRect.set({ x: 1, y: 1, width: 10, height: 8 });

      internals().onKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      await flush();

      expect(document().size()).toEqual({ width: 10, height: 8 });
    });
  });

  describe('the resize tool', () => {
    it('applies_theEnteredSize', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('resize');
      internals().onResizeUnit('px');
      internals().onResizeWidth(20);

      view.applyResize();
      await flush();

      expect(document().size()).toEqual({ width: 20, height: 15 });
      expect(view.tool()).toBe('none');
    });

    it('derivesTheWidth_fromAnEnteredHeight', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('resize');

      internals().onResizeHeight(60);

      expect(internals().resizeWidth()).toBe(80);
    });

    it('neverAsksForAnEdgeOfNothing', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('resize');
      internals().onResizeUnit('px');

      internals().onResizeWidth(0);

      expect(internals().resizeTarget().width).toBeGreaterThan(0);
      expect(internals().resizeTarget().height).toBeGreaterThan(0);
    });

    it('resampling_fallsBackToSmooth_forAnUnknownChoice', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('resize');
      internals().onResizeResampling('pixelated');
      internals().onResizeResampling('nonsense');
      internals().onResizeWidth(20);

      const apply: MockInstance = vi.spyOn(document(), 'apply');
      view.applyResize();

      expect(apply).toHaveBeenCalledWith(expect.objectContaining({ resampling: 'smooth' }));
    });
  });

  describe('exporting', () => {
    it('closesTheTool_onceWritten', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('export');
      vi.spyOn(documents, 'exportInteractive').mockResolvedValue('exported');

      await view.applyExport();

      expect(view.tool()).toBe('none');
      expect(failures()).toEqual([]);
    });

    it('keepsTheToolOpen_whenTheDialogIsCancelled', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('export');
      vi.spyOn(documents, 'exportInteractive').mockResolvedValue('cancelled');

      await view.applyExport();

      expect(view.tool()).toBe('export');
      expect(failures()).toEqual([]);
    });

    it('saysSo_whenItFails', async () => {
      await mount('/pictures/photo.png');
      view.toggleTool('export');
      vi.spyOn(documents, 'exportInteractive').mockResolvedValue('failed');

      await view.applyExport();

      expect(failures()).toEqual(['Could not export photo.png']);
    });

    it('showsTheSizeItWillWrite', async () => {
      await mount('/pictures/photo.png');
      internals().exportScale.set(50);

      expect(internals().exportSize()).toEqual({ width: 20, height: 15 });
    });

    it('knowsPngIsLossless', async () => {
      await mount('/pictures/photo.png');
      internals().onExportType('image/png');
      expect(internals().exportIsLossy()).toBe(false);

      internals().onExportType('image/webp');
      expect(internals().exportIsLossy()).toBe(true);
    });

    it('ignoresAFormatItCannotEncode', async () => {
      await mount('/pictures/photo.png');
      internals().onExportType('image/png');

      internals().onExportType('image/tiff');

      expect(internals().exportType()).toBe('image/png');
    });
  });

  describe('saving', () => {
    it('doesNothing_withNoEdits', async () => {
      await mount('/pictures/photo.png');
      const saving: MockInstance = vi.spyOn(documents, 'save');

      await view.save();

      expect(saving).not.toHaveBeenCalled();
    });

    it('saysSo_whenTheWriteFails', async () => {
      await mount('/pictures/photo.png');
      view.rotate(true);
      await flush();
      vi.spyOn(documents, 'save').mockResolvedValue(false);

      await view.save();

      expect(failures()).toEqual(['Could not save photo.png']);
    });

    it('keepsAnUnwritableFormatsEdits_inTheChosenFallback', async () => {
      TestBed.inject(Settings).set('imageViewer.fallbackSaveFormat', 'webp');
      await mount('/pictures/anim.gif');
      localStorage.removeItem('settings');
      view.flip('horizontal');
      await flush();
      const exporting: MockInstance = vi
        .spyOn(documents, 'exportInteractive')
        .mockResolvedValue('cancelled');

      await view.save();

      expect(exporting.mock.calls[0]?.[1]).toMatchObject({
        type: 'image/webp',
        scalePercent: 100,
      });
      expect(failures()).toEqual([]);
    });

    it('saysSo_whenTheFallbackFails', async () => {
      TestBed.inject(Settings).set('imageViewer.fallbackSaveFormat', 'png');
      await mount('/pictures/anim.gif');
      localStorage.removeItem('settings');
      view.flip('horizontal');
      await flush();
      vi.spyOn(documents, 'exportInteractive').mockResolvedValue('failed');

      await view.save();

      expect(failures()).toEqual(['Could not save anim.gif']);
    });
  });

  describe('undoing', () => {
    it('undo_andRedo_walkTheEdits', async () => {
      await mount('/pictures/photo.png');
      view.rotate(true);
      await flush();

      view.undo();
      await flush();
      expect(document().size()).toEqual({ width: 40, height: 30 });

      view.redo();
      await flush();
      expect(document().size()).toEqual({ width: 30, height: 40 });
    });

    it('undo_whenTheImageCannotBeRedrawn_saysSo', async () => {
      await mount('/pictures/photo.png');
      view.rotate(true);
      await flush();
      view.rotate(true);
      await flush();
      vi.spyOn(raster, 'objectUrl').mockRejectedValue(new Error('out of memory'));

      view.undo();
      await flush();

      expect(failures()).toEqual(['Could not edit photo.png']);
    });
  });

  describe('chords', () => {
    it('reachEveryCommand', async () => {
      await mount('/pictures/photo.png');
      const matches: MockInstance = vi.spyOn(TestBed.inject(Keybindings), 'matches');
      const press: (command: string) => KeyboardEvent = (command: string): KeyboardEvent => {
        matches.mockImplementation((_event: KeyboardEvent, id: string): boolean => id === command);
        const event: KeyboardEvent = new KeyboardEvent('keydown', {
          key: 'x',
          cancelable: true,
        });
        internals().onKeydown(event);
        return event;
      };

      press('image.zoomIn');
      expect(view.isFitted()).toBe(false);
      press('image.fit');
      expect(view.isFitted()).toBe(true);
      press('image.actualSize');
      expect(view.zoomLabel()).toBe('100%');
      press('image.zoomOut');
      expect(view.scale()).toBeLessThan(1);
      press('image.exportAs');
      expect(view.tool()).toBe('export');
    });

    it('leavesAKeyItDoesNotOwn', async () => {
      await mount('/pictures/photo.png');

      const event: KeyboardEvent = new KeyboardEvent('keydown', { key: 'q', cancelable: true });
      internals().onKeydown(event);

      expect(event.defaultPrevented).toBe(false);
    });
  });
});
