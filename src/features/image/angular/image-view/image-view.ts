import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  signal,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { EncodableImageType, ENCODABLE_IMAGE_TYPES } from '@shared/api/image-formats';
import { Button } from '@shared/angular/components/forms/button/button';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { NumberField } from '@shared/angular/components/forms/number-field/number-field';
import { Slider } from '@shared/angular/components/forms/slider/slider';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Icon } from '@shared/angular/icons/icon';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';
import {
  ImageDocument,
  ImageDocuments,
  ImageExportOptions,
} from '../image-document/image-document';
import {
  clampEdge,
  clampZoom,
  fitScale,
  formatFileSize,
  formatZoom,
  ImageRect,
  ImageSize,
  isUsefulCrop,
  rectBetween,
  resizeKeepingAspect,
  scaleByPercent,
  zoomInFrom,
  zoomOutFrom,
} from '../image-geometry/image-geometry';
import { ImageStatus } from '../image-status/image-status';
import { ImageViews } from '../image-views/image-views';

/**
 * Names the backdrop an image is shown against: a checkerboard that makes transparency visible, or
 * a plain light or dark ground.
 */
export type ImageBackground = 'checker' | 'light' | 'dark';

/**
 * Names the editing tool open over the image, or `none` when the image is only being viewed.
 */
export type ImageTool = 'none' | 'crop' | 'resize' | 'export';

/**
 * Names where a view is hosted: as a top-level tab, or inside a workspace's document well.
 */
export type ImageHost = 'tab' | 'well';

/**
 * Specifies the breathing room, in pixels, kept around a fitted image on every side.
 */
const FIT_MARGIN: number = 16;

/**
 * Specifies how strongly one wheel notch of a ⌘-wheel or pinch zooms.
 */
const WHEEL_ZOOM_RATE: number = 0.01;

/**
 * Lists the export formats offered, labelled for the dropdown.
 */
const EXPORT_FORMAT_OPTIONS: readonly DropdownOption[] = ENCODABLE_IMAGE_TYPES.map(
  (type: EncodableImageType): DropdownOption => ({
    value: type,
    label: { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' }[type],
  }),
);

/**
 * Describes a drag in progress over the image: a pan of the viewport, or a crop rectangle being
 * drawn.
 */
type Drag =
  | {
      readonly kind: 'pan';
      readonly pointerId: number;
      readonly startX: number;
      readonly startY: number;
      readonly scrollLeft: number;
      readonly scrollTop: number;
    }
  | {
      readonly kind: 'crop';
      readonly pointerId: number;
      readonly origin: { readonly x: number; readonly y: number };
    };

/**
 * Represents the image viewer: one image, fitted to the window on open, zoomed and panned, shown
 * against a chosen backdrop, and edited in place — rotate, flip, crop, resize — with export to PNG,
 * JPEG or WebP. The same view is the image tab's view and the body of an image in a workspace's
 * document well; only its host differs. As a tab it publishes its status strip and accelerators
 * itself; in a well, the well panel publishes to the well's own strip.
 *
 * The view owns how the image is looked at (zoom, backdrop, tool); the shared {@link ImageDocument}
 * owns the pixels, so an edit made here shows in every other host of the same file.
 */
@Component({
  selector: 'app-image-view',
  imports: [Button, Checkbox, Dropdown, NumberField, PanelToolbar, Slider],
  // One per view: the status strip reads this view's own context through its injector.
  providers: [ImageStatus],
  templateUrl: './image-view.html',
  styleUrl: './image-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    tabindex: '0',
    '(keydown)': 'onKeydown($event)',
  },
})
export class ImageView implements OnInit, OnDestroy {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the export format options, exposed for the template.
   */
  protected readonly exportFormats: readonly DropdownOption[] = EXPORT_FORMAT_OPTIONS;

  /**
   * Gets the resize unit options, exposed for the template.
   */
  protected readonly resizeUnits: readonly DropdownOption[] = [
    { value: 'px', label: 'Pixels' },
    { value: '%', label: 'Percent' },
  ];

  /**
   * Gets the identifier of what hosts the view — the tab id as a tab, the panel id in a well — which
   * is also the id it holds its document under.
   *
   * Not a required input, deliberately: a well panel reads the view's signals from an effect of its
   * own, which runs before the panel's template has bound this input, and a required input read that
   * early throws. Until it is bound, the empty id holds no document and the view shows nothing.
   */
  public readonly tabId: InputSignal<string> = input<string>('');

  /**
   * Gets a value indicating whether the view is the one on screen.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets where the view is hosted.
   */
  public readonly host: InputSignal<ImageHost> = input<ImageHost>('tab');

  /**
   * Holds the shared image documents.
   */
  private readonly documents: ImageDocuments = inject(ImageDocuments);

  /**
   * Holds the registry the tab host registers with, for its ribbon.
   */
  private readonly views: ImageViews = inject(ImageViews);

  /**
   * Holds this view's status context.
   */
  private readonly status: ImageStatus = inject(ImageStatus);

  /**
   * Holds the file opener of wherever the view is hosted — a workspace's own inside its well — so
   * "open as text" lands beside the image.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the accelerator registry, for the tab host's scope and the chords handled on focus.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the injector post-render scroll adjustments are scheduled in.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the view's host element, focused so its chords apply.
   */
  private readonly hostElement: ElementRef<HTMLElement> =
    inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Publishes this view's injector while it is the active tab, so the shell's status strip mounts
   * the image status inside it. Only a tab host registers.
   */
  private readonly statusHost: ViewInjectorRegistrar = createViewInjectorRegistrar({
    isActive: this.isActive,
  });

  /**
   * Holds the scrolling viewport the image sits in.
   */
  private readonly viewport: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('viewport');

  /**
   * Holds the stage — the image's own box — within the viewport.
   */
  private readonly stage: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('stage');

  /**
   * Holds the viewport's measured size.
   */
  private readonly viewportSize: WritableSignal<ImageSize> = signal<ImageSize>({
    width: 0,
    height: 0,
  });

  /**
   * Holds the zoom: `fit` follows the window, a number is a fixed scale.
   */
  private readonly zoom: WritableSignal<'fit' | number> = signal<'fit' | number>('fit');

  /**
   * Holds the drag in progress, or null.
   */
  private drag: Drag | null = null;

  /**
   * Gets the document the view shows.
   */
  public readonly document: Signal<ImageDocument | undefined> = computed(
    (): ImageDocument | undefined => {
      // Re-read when the tab id changes; the registry is not itself reactive.
      return this.documents.forHolder(this.tabId());
    },
  );

  /**
   * Gets the backdrop the image is shown against.
   */
  public readonly background: WritableSignal<ImageBackground> = signal<ImageBackground>('checker');

  /**
   * Gets the editing tool open over the image.
   */
  public readonly tool: WritableSignal<ImageTool> = signal<ImageTool>('none');

  /**
   * Gets the crop rectangle drawn so far, in image pixels, or null before one is drawn.
   */
  public readonly cropRect: WritableSignal<ImageRect | null> = signal<ImageRect | null>(null);

  /**
   * Gets the scale the image is drawn at.
   */
  public readonly scale: Signal<number> = computed((): number => {
    const zoom: 'fit' | number = this.zoom();
    if (zoom !== 'fit') {
      return zoom;
    }
    const size: ImageSize | null = this.document()?.size() ?? null;
    const viewport: ImageSize = this.viewportSize();
    return size === null
      ? 1
      : fitScale(size, {
          width: viewport.width - FIT_MARGIN * 2,
          height: viewport.height - FIT_MARGIN * 2,
        });
  });

  /**
   * Gets a value indicating whether the image is fitted to the window.
   */
  public readonly isFitted: Signal<boolean> = computed((): boolean => this.zoom() === 'fit');

  /**
   * Gets the zoom as a percentage label.
   */
  public readonly zoomLabel: Signal<string> = computed((): string => formatZoom(this.scale()));

  /**
   * Gets the drawn size of the image's box, in CSS pixels.
   */
  protected readonly stageSize: Signal<ImageSize | null> = computed((): ImageSize | null => {
    const size: ImageSize | null = this.document()?.size() ?? null;
    const scale: number = this.scale();
    return size === null
      ? null
      : { width: Math.max(1, size.width * scale), height: Math.max(1, size.height * scale) };
  });

  /**
   * Gets the crop rectangle scaled to the stage, for drawing.
   */
  protected readonly cropBox: Signal<ImageRect | null> = computed((): ImageRect | null => {
    const rect: ImageRect | null = this.cropRect();
    const scale: number = this.scale();
    return rect === null
      ? null
      : {
          x: rect.x * scale,
          y: rect.y * scale,
          width: rect.width * scale,
          height: rect.height * scale,
        };
  });

  /**
   * Gets a note about how editing behaves for this image, or null.
   */
  public readonly editingNote: Signal<string | null> = computed((): string | null => {
    const document: ImageDocument | undefined = this.document();
    if (document?.isVector === true) {
      return 'Vector image — export to edit as pixels';
    }
    if (document?.isAnimatable === true) {
      return 'Editing flattens the animation';
    }
    return null;
  });

  /**
   * Gets the resize width being entered, in pixels.
   */
  protected readonly resizeWidth: WritableSignal<number> = signal<number>(1);

  /**
   * Gets the resize height being entered, in pixels.
   */
  protected readonly resizeHeight: WritableSignal<number> = signal<number>(1);

  /**
   * Gets the resize percentage being entered.
   */
  protected readonly resizePercent: WritableSignal<number> = signal<number>(100);

  /**
   * Gets the resize unit.
   */
  protected readonly resizeUnit: WritableSignal<'px' | '%'> = signal<'px' | '%'>('px');

  /**
   * Gets a value indicating whether the resize keeps the aspect ratio.
   */
  protected readonly resizeLocked: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets the export format.
   */
  protected readonly exportType: WritableSignal<EncodableImageType> =
    signal<EncodableImageType>('image/png');

  /**
   * Gets the export quality, as a percentage.
   */
  protected readonly exportQuality: WritableSignal<number> = signal<number>(90);

  /**
   * Gets the export scale, as a percentage.
   */
  protected readonly exportScale: WritableSignal<number> = signal<number>(100);

  /**
   * Gets a value indicating whether the chosen export format is lossy, so the quality applies.
   */
  protected readonly exportIsLossy: Signal<boolean> = computed(
    (): boolean => this.exportType() !== 'image/png',
  );

  /**
   * Gets the size the export will be written at.
   */
  protected readonly exportSize: Signal<ImageSize | null> = computed((): ImageSize | null => {
    const size: ImageSize | null = this.document()?.size() ?? null;
    return size === null ? null : scaleByPercent(size, this.exportScale());
  });

  /**
   * Initializes a new instance of the {@link ImageView} class, keeping the status context and the
   * viewport measurement current.
   */
  public constructor() {
    // Keep the tab's status strip current. Activation is not consulted: the strip mounts this view's
    // status component only while the view is active.
    effect((): void => {
      const document: ImageDocument | undefined = this.document();
      if (document === undefined) {
        this.status.clear();
        return;
      }
      const size: ImageSize | null = document.size();
      const fileSize: number | null = document.fileSize();
      this.status.publish({
        path: document.path,
        format: document.format,
        dimensions: size === null ? null : `${size.width} × ${size.height}`,
        fileSize: fileSize === null ? null : formatFileSize(fileSize),
        zoom: this.zoomLabel(),
        note: this.editingNote(),
        dirty: document.dirty(),
      });
    });

    // A tab host registers its accelerators while it is the active tab; a well host cannot (the
    // workspace tab owns that scope) and handles its chords on focus instead.
    effect((): void => {
      if (this.host() !== 'tab') {
        return;
      }
      const tabId: string = this.tabId();
      if (this.isActive()) {
        untracked((): void => this.registerKeybindings(tabId));
      } else {
        this.keybindings.deactivate(tabId);
      }
    });

    // Measure the viewport, so fitting follows the window as it is resized.
    const destroyRef: DestroyRef = inject(DestroyRef);
    effect((): void => {
      const element: HTMLElement | undefined = this.viewport()?.nativeElement;
      if (element === undefined || typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer: ResizeObserver = new ResizeObserver((): void =>
        this.viewportSize.set({ width: element.clientWidth, height: element.clientHeight }),
      );
      observer.observe(element);
      destroyRef.onDestroy((): void => observer.disconnect());
    });
  }

  /**
   * Registers a tab host with the ribbon's registry and the status strip.
   */
  public ngOnInit(): void {
    if (this.host() === 'tab') {
      this.views.register(this.tabId(), this);
      this.statusHost.register(this.tabId());
    }
    this.log.info('image.view', `Image view opened (${this.host()})`, this.tabId());
  }

  /**
   * Releases a tab host's hold on its document and its registrations. A well host's hold outlives
   * the view — a panel is re-created when it is moved — and is released when the panel closes.
   */
  public ngOnDestroy(): void {
    if (this.host() === 'tab') {
      this.views.unregister(this.tabId(), this);
      this.keybindings.forget(this.tabId());
      this.documents.releaseHolder(this.tabId());
    }
    this.log.info('image.view', 'Image view closed', this.tabId());
  }

  /**
   * Zooms in to the next stop.
   */
  public zoomIn(): void {
    this.zoomTo(zoomInFrom(this.scale()));
  }

  /**
   * Zooms out to the next stop.
   */
  public zoomOut(): void {
    this.zoomTo(zoomOutFrom(this.scale()));
  }

  /**
   * Shows the image at its actual size, one image pixel to one CSS pixel.
   */
  public actualSize(): void {
    this.zoomTo(1);
  }

  /**
   * Fits the image to the window, following the window as it is resized.
   */
  public fit(): void {
    this.zoom.set('fit');
  }

  /**
   * Rotates the image a quarter turn.
   * @param clockwise Whether to turn clockwise.
   */
  public rotate(clockwise: boolean): void {
    this.edit((document: ImageDocument): Promise<boolean> =>
      document.apply({ kind: 'rotate', clockwise }),
    );
  }

  /**
   * Flips the image.
   * @param axis The axis to flip across.
   */
  public flip(axis: 'horizontal' | 'vertical'): void {
    this.edit((document: ImageDocument): Promise<boolean> =>
      document.apply({ kind: 'flip', axis }),
    );
  }

  /**
   * Opens a tool over the image, or closes it when it is already open.
   * @param tool The tool to open.
   */
  public toggleTool(tool: Exclude<ImageTool, 'none'>): void {
    if (this.tool() === tool) {
      this.cancelTool();
      return;
    }
    const document: ImageDocument | undefined = this.document();
    if (document === undefined) {
      return;
    }
    if (tool !== 'export' && !document.canEdit()) {
      return;
    }
    this.cropRect.set(null);
    if (tool === 'resize') {
      const size: ImageSize | null = document.size();
      this.resizeWidth.set(size?.width ?? 1);
      this.resizeHeight.set(size?.height ?? 1);
      this.resizePercent.set(100);
    }
    if (tool === 'export') {
      this.exportType.set(
        document.canSaveInPlace ? (document.mime as EncodableImageType) : 'image/png',
      );
    }
    this.tool.set(tool);
    this.focus();
  }

  /**
   * Closes the open tool, discarding anything it had pending.
   */
  public cancelTool(): void {
    this.tool.set('none');
    this.cropRect.set(null);
  }

  /**
   * Applies the drawn crop rectangle, keeping only what is inside it.
   */
  public applyCrop(): void {
    const rect: ImageRect | null = this.cropRect();
    const size: ImageSize | null = this.document()?.size() ?? null;
    if (rect === null || size === null || !isUsefulCrop(rect, size)) {
      return;
    }
    this.edit((document: ImageDocument): Promise<boolean> =>
      document.apply({ kind: 'crop', rect }),
    );
    this.cancelTool();
  }

  /**
   * Applies the entered resize.
   */
  public applyResize(): void {
    const size: ImageSize = this.resizeTarget();
    this.edit((document: ImageDocument): Promise<boolean> =>
      document.apply({ kind: 'resize', width: size.width, height: size.height }),
    );
    this.cancelTool();
  }

  /**
   * Exports the image with the entered format, quality and scale, asking where to write it.
   * @returns Returns a promise that resolves once the export has settled.
   */
  public async applyExport(): Promise<void> {
    const document: ImageDocument | undefined = this.document();
    if (document === undefined) {
      return;
    }
    const options: ImageExportOptions = {
      type: this.exportType(),
      quality: this.exportQuality() / 100,
      scalePercent: this.exportScale(),
    };
    if (await this.documents.exportInteractive(document, options)) {
      this.cancelTool();
    }
  }

  /**
   * Saves the image's edits over the file. A format that cannot be written back opens the export
   * tool instead, so the edits can be kept in one that can.
   * @returns Returns a promise that resolves once the save has settled.
   */
  public async save(): Promise<void> {
    const document: ImageDocument | undefined = this.document();
    if (document?.dirty() !== true) {
      return;
    }
    if (!document.canSaveInPlace) {
      this.log.info('image.view', 'Format cannot be written back; opening export', document.path);
      if (this.tool() !== 'export') {
        this.toggleTool('export');
      }
      return;
    }
    await this.documents.save(document.path);
  }

  /**
   * Undoes the most recent edit.
   */
  public undo(): void {
    void this.document()?.undo();
  }

  /**
   * Redoes the most recently undone edit.
   */
  public redo(): void {
    void this.document()?.redo();
  }

  /**
   * Opens the image in the binary editor, so its bytes can be inspected.
   */
  public openInBinaryEditor(): void {
    const document: ImageDocument | undefined = this.document();
    if (document !== undefined) {
      this.fileOpener.openAsBinary(document.path);
    }
  }

  /**
   * Opens an SVG's source as text beside the image.
   */
  public openSource(): void {
    const document: ImageDocument | undefined = this.document();
    if (document !== undefined) {
      void this.fileOpener.openAsText(document.path);
    }
  }

  /**
   * Handles the chords the view answers while it has focus: zoom, save, export, and the tools'
   * Enter and Escape. A chord it handles goes no further, so the host tab's own accelerators do not
   * also fire.
   * @param event The key event.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const handled: boolean = this.handleKey(event);
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /**
   * Starts a pan or a crop drag.
   * @param event The pointer event.
   */
  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    this.focus();
    const viewport: HTMLElement | undefined = this.viewport()?.nativeElement;
    if (viewport === undefined) {
      return;
    }
    if (this.tool() === 'crop') {
      const point: { x: number; y: number } | null = this.imagePoint(event);
      if (point === null) {
        return;
      }
      this.drag = { kind: 'crop', pointerId: event.pointerId, origin: point };
      this.cropRect.set(null);
    } else {
      this.drag = {
        kind: 'pan',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      };
    }
    viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  /**
   * Moves the pan or grows the crop rectangle.
   * @param event The pointer event.
   */
  protected onPointerMove(event: PointerEvent): void {
    const drag: Drag | null = this.drag;
    if (drag?.pointerId !== event.pointerId) {
      return;
    }
    if (drag.kind === 'pan') {
      const viewport: HTMLElement | undefined = this.viewport()?.nativeElement;
      if (viewport !== undefined) {
        viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
        viewport.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
      }
      return;
    }
    const point: { x: number; y: number } | null = this.imagePoint(event);
    const size: ImageSize | null = this.document()?.size() ?? null;
    if (point !== null && size !== null) {
      this.cropRect.set(rectBetween(drag.origin, point, size));
    }
  }

  /**
   * Ends the drag.
   * @param event The pointer event.
   */
  protected onPointerUp(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) {
      this.viewport()?.nativeElement.releasePointerCapture?.(event.pointerId);
      this.drag = null;
    }
  }

  /**
   * Zooms with ⌘-wheel or a trackpad pinch (which Chromium reports as a ctrl-wheel), keeping the
   * point under the pointer where it is. A plain wheel scrolls as usual.
   * @param event The wheel event.
   */
  protected onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    this.zoomTo(this.scale() * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }

  /**
   * Updates the resize width, deriving the height when the aspect is locked.
   * @param width The entered width.
   */
  protected onResizeWidth(width: number): void {
    this.resizeWidth.set(clampEdge(width));
    const size: ImageSize | null = this.document()?.size() ?? null;
    if (this.resizeLocked() && size !== null) {
      this.resizeHeight.set(resizeKeepingAspect(size, 'width', width).height);
    }
  }

  /**
   * Updates the resize height, deriving the width when the aspect is locked.
   * @param height The entered height.
   */
  protected onResizeHeight(height: number): void {
    this.resizeHeight.set(clampEdge(height));
    const size: ImageSize | null = this.document()?.size() ?? null;
    if (this.resizeLocked() && size !== null) {
      this.resizeWidth.set(resizeKeepingAspect(size, 'height', height).width);
    }
  }

  /**
   * Updates the resize unit.
   * @param unit The chosen unit.
   */
  protected onResizeUnit(unit: string): void {
    this.resizeUnit.set(unit === '%' ? '%' : 'px');
  }

  /**
   * Updates the export format.
   * @param type The chosen format.
   */
  protected onExportType(type: string): void {
    const chosen: EncodableImageType | undefined = ENCODABLE_IMAGE_TYPES.find(
      (candidate: EncodableImageType): boolean => candidate === type,
    );
    if (chosen !== undefined) {
      this.exportType.set(chosen);
    }
  }

  /**
   * Gets the size the resize tool would produce.
   * @returns Returns the target size.
   */
  protected resizeTarget(): ImageSize {
    const size: ImageSize | null = this.document()?.size() ?? null;
    if (this.resizeUnit() === '%' && size !== null) {
      return scaleByPercent(size, this.resizePercent());
    }
    return { width: clampEdge(this.resizeWidth()), height: clampEdge(this.resizeHeight()) };
  }

  /**
   * Resolves a chord to one of the view's commands.
   * @param event The key event.
   * @returns Returns true when the chord was handled.
   */
  private handleKey(event: KeyboardEvent): boolean {
    const mod: boolean = event.metaKey || event.ctrlKey;
    if (this.keybindings.matches(event, 'image.zoomIn') || (mod && event.key === '+')) {
      this.zoomIn();
    } else if (this.keybindings.matches(event, 'image.zoomOut')) {
      this.zoomOut();
    } else if (this.keybindings.matches(event, 'image.actualSize')) {
      this.actualSize();
    } else if (this.keybindings.matches(event, 'image.fit')) {
      this.fit();
    } else if (this.keybindings.matches(event, 'image.save')) {
      void this.save();
    } else if (this.keybindings.matches(event, 'image.exportAs')) {
      this.toggleTool('export');
    } else if (event.key === 'Escape' && this.tool() !== 'none') {
      this.cancelTool();
    } else if (event.key === 'Enter' && this.tool() === 'crop') {
      this.applyCrop();
    } else {
      return false;
    }
    return true;
  }

  /**
   * Registers the tab host's accelerators, so they fire from anywhere on the tab — the ribbon
   * included — and are listed by the shortcuts overlay.
   * @param tabId The tab's identifier.
   */
  private registerKeybindings(tabId: string): void {
    this.keybindings.register(tabId, [
      { id: 'image.zoomIn', command: (): void => this.zoomIn() },
      { id: 'image.zoomOut', command: (): void => this.zoomOut() },
      { id: 'image.actualSize', command: (): void => this.actualSize() },
      { id: 'image.fit', command: (): void => this.fit() },
      { id: 'image.save', command: (): void => void this.save() },
      { id: 'image.exportAs', command: (): void => this.toggleTool('export') },
    ]);
  }

  /**
   * Runs an edit against the document, logging when it could not be applied.
   * @param run The edit to run.
   */
  private edit(run: (document: ImageDocument) => Promise<boolean>): void {
    const document: ImageDocument | undefined = this.document();
    if (document === undefined) {
      return;
    }
    run(document).catch((error: unknown): void =>
      this.log.error('image.view', 'Image edit failed', document.path, error),
    );
  }

  /**
   * Sets a fixed zoom, keeping a point of the viewport steady — the pointer for a wheel zoom, the
   * centre otherwise — so zooming does not throw the image away from where the user was looking.
   * @param scale The scale to zoom to.
   * @param anchor The viewport point to keep steady, in client coordinates; the centre when absent.
   * @param anchor.clientX The anchor's horizontal client coordinate.
   * @param anchor.clientY The anchor's vertical client coordinate.
   */
  private zoomTo(scale: number, anchor?: { clientX: number; clientY: number }): void {
    const next: number = clampZoom(scale);
    const previous: number = this.scale();
    const viewport: HTMLElement | undefined = this.viewport()?.nativeElement;
    const stage: HTMLElement | undefined = this.stage()?.nativeElement;
    this.zoom.set(next);
    if (viewport === undefined || stage === undefined || previous === next) {
      return;
    }
    const bounds: DOMRect = viewport.getBoundingClientRect();
    const offsetX: number = (anchor?.clientX ?? bounds.left + bounds.width / 2) - bounds.left;
    const offsetY: number = (anchor?.clientY ?? bounds.top + bounds.height / 2) - bounds.top;
    // The image point under the anchor, before the zoom.
    const imageX: number = (viewport.scrollLeft + offsetX - stage.offsetLeft) / previous;
    const imageY: number = (viewport.scrollTop + offsetY - stage.offsetTop) / previous;
    afterNextRender(
      (): void => {
        viewport.scrollLeft = imageX * next + stage.offsetLeft - offsetX;
        viewport.scrollTop = imageY * next + stage.offsetTop - offsetY;
      },
      { injector: this.injector },
    );
  }

  /**
   * Converts a pointer position to image pixels.
   * @param event The pointer event.
   * @returns Returns the image point, or null when the stage is not rendered.
   */
  private imagePoint(event: PointerEvent): { x: number; y: number } | null {
    const stage: HTMLElement | undefined = this.stage()?.nativeElement;
    if (stage === undefined) {
      return null;
    }
    const bounds: DOMRect = stage.getBoundingClientRect();
    const scale: number = this.scale();
    return { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale };
  }

  /**
   * Moves keyboard focus to the view, so its chords apply.
   */
  private focus(): void {
    this.hostElement.nativeElement.focus({ preventScroll: true });
  }
}
