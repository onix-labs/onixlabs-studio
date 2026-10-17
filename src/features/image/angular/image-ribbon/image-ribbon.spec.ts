import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ImageDocument } from '../image-document/image-document';
import { ImageBackground, ImageTool, ImageView } from '../image-view/image-view';
import { ImageViews } from '../image-views/image-views';
import { ImageRibbon } from './image-ribbon';

/**
 * Describes the stand-in view the ribbon drives: the signals it reads and a log of the commands it
 * issues.
 */
interface StubView {
  readonly view: ImageView;
  readonly calls: string[];
  readonly background: WritableSignal<ImageBackground>;
  readonly vector: WritableSignal<boolean>;
}

/**
 * Builds a stand-in view over an edited, editable image, recording every command.
 * @returns Returns the stub.
 */
function stubView(): StubView {
  const calls: string[] = [];
  const background: WritableSignal<ImageBackground> = signal<ImageBackground>('checker');
  const vector: WritableSignal<boolean> = signal<boolean>(false);
  const document: Partial<ImageDocument> = {
    dirty: signal<boolean>(true),
    canUndo: signal<boolean>(true),
    canRedo: signal<boolean>(true),
    canEdit: signal<boolean>(true),
    get isVector(): boolean {
      return vector();
    },
  };
  const record: (name: string) => (...args: unknown[]) => void =
    (name: string): ((...args: unknown[]) => void) =>
    (...args: unknown[]): void =>
      void calls.push([name, ...args.map(String)].join(':'));
  const view: Partial<Record<keyof ImageView, unknown>> = {
    document: signal<ImageDocument>(document as ImageDocument),
    background,
    tool: signal<ImageTool>('none'),
    isFitted: signal<boolean>(true),
    save: record('save'),
    undo: record('undo'),
    redo: record('redo'),
    rotate: record('rotate'),
    flip: record('flip'),
    toggleTool: record('tool'),
    zoomIn: record('zoomIn'),
    zoomOut: record('zoomOut'),
    actualSize: record('actualSize'),
    fit: record('fit'),
    openInBinaryEditor: record('binary'),
    openSource: record('source'),
  };
  return { view: view as unknown as ImageView, calls, background, vector };
}

describe('ImageRibbon', () => {
  let fixture: ComponentFixture<ImageRibbon>;
  let stub: StubView;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ImageRibbon] }).compileComponents();
    const tabs: Tabs = TestBed.inject(Tabs);
    const tab: Tab = tabs.open('image', '/pictures/photo.png');
    tabs.activate(tab.id);
    stub = stubView();
    TestBed.inject(ImageViews).register(tab.id, stub.view);
    fixture = TestBed.createComponent(ImageRibbon);
    fixture.detectChanges();
    TestBed.tick();
  });

  /**
   * Clicks the ribbon control carrying a label.
   * @param label The control's label.
   */
  function click(label: string): void {
    const buttons: HTMLElement[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('button'),
    );
    const button: HTMLElement | undefined = buttons.find(
      (candidate: HTMLElement): boolean => candidate.textContent?.trim() === label,
    );
    expect(button, `no ribbon button labelled '${label}'`).toBeDefined();
    button!.click();
  }

  it('buttons_driveTheActiveView', () => {
    for (const label of [
      'Save',
      'Export As',
      'Undo',
      'Redo',
      'Rotate Left',
      'Rotate Right',
      'Flip Horizontal',
      'Flip Vertical',
      'Crop',
      'Resize',
      'Zoom In',
      'Zoom Out',
      'Actual Size',
      'Fit to Window',
      'Binary Editor',
    ]) {
      click(label);
    }

    expect(stub.calls).toEqual([
      'save',
      'tool:export',
      'undo',
      'redo',
      'rotate:false',
      'rotate:true',
      'flip:horizontal',
      'flip:vertical',
      'tool:crop',
      'tool:resize',
      'zoomIn',
      'zoomOut',
      'actualSize',
      'fit',
      'binary',
    ]);
  });

  it('backgroundButtons_setTheViewsBackdrop', () => {
    click('Dark');
    expect(stub.background()).toBe('dark');
    click('Light');
    expect(stub.background()).toBe('light');
    click('Checkerboard');
    expect(stub.background()).toBe('checker');
  });

  it('sourceButton_appearsOnlyForAnSvgAndOpensItsSource', () => {
    const labels: () => string[] = (): string[] =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).map(
        (button: HTMLButtonElement): string => button.textContent?.trim() ?? '',
      );
    expect(labels()).not.toContain('Source');

    const svg: StubView = stubView();
    svg.vector.set(true);
    TestBed.inject(ImageViews).register(TestBed.inject(Tabs).activeTabId()!, svg.view);
    fixture.detectChanges();

    click('Source');
    expect(svg.calls).toEqual(['source']);
  });

  it('menu_dispatchesTheImageCommandsToTheActiveView', () => {
    const menu: AppMenu = TestBed.inject(AppMenu);
    for (const id of [
      'image.zoomIn',
      'image.zoomOut',
      'image.actualSize',
      'image.fit',
      'image.rotateLeft',
      'image.rotateRight',
      'image.flipHorizontal',
      'image.flipVertical',
      'image.exportAs',
      'image.openInBinaryEditor',
    ]) {
      menu.dispatch(id);
    }

    expect(stub.calls).toEqual([
      'zoomIn',
      'zoomOut',
      'actualSize',
      'fit',
      'rotate:false',
      'rotate:true',
      'flip:horizontal',
      'flip:vertical',
      'tool:export',
      'binary',
    ]);
  });
});
