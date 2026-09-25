import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { WorkspaceChannel } from '@shared/api/workspace-channels';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import {
  DocumentStatus,
  DocumentStatusInfo,
} from '@shared/angular/services/document-status/document-status';
import { RecentItems } from '@shared/angular/services/recent-items/recent-items';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ImageDocuments } from '../image-document/image-document';
import { ImageOpener } from '../image-opener/image-opener';
import { ImageRaster } from '../image-raster/image-raster';
import { FakeImageRaster } from '../testing/fake-image-raster';
import { ImageWellPanel } from './image-well-panel';

/**
 * Builds a fake transport answering the file-size read every image makes when it opens.
 * @returns Returns the fake bridge.
 */
function fakeBridge(): Bridge {
  return {
    invoke: <T>(channel: string): Promise<T> =>
      Promise.resolve(
        (channel === (WorkspaceChannel.ReadBytes as string)
          ? { size: 512, offset: 0, bytes: new Uint8Array(1) }
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

describe('ImageWellPanel', () => {
  let fixture: ComponentFixture<ImageWellPanel>;
  let panel: DockPanel;

  beforeEach(async () => {
    (window as unknown as { bridge: Bridge }).bridge = fakeBridge();
    await TestBed.configureTestingModule({
      imports: [ImageWellPanel],
      providers: [{ provide: ImageRaster, useValue: new FakeImageRaster() }],
    }).compileComponents();
    panel = TestBed.inject(ImageOpener).wellPanel('/ws/art/logo.gif', 'workspace-tab');
    await flush();
    // Put the panel in the well and make it the active document there, as the file opener would.
    TestBed.inject(DockPanelRegistry).register(panel);
    const dockState: DockState = TestBed.inject(DockState);
    const well: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
    dockState.tabInto(well!.id, panel.id);
    fixture = TestBed.createComponent(ImageWellPanel);
    fixture.componentRef.setInput('panel', panel);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('describesItselfAsAnImageDocumentThatOwnsItsToolStrip', () => {
    expect(panel.id).toBe('image-well:workspace-tab:/ws/art/logo.gif');
    expect(panel.title).toBe('logo.gif');
    expect(panel.role).toBe('document');
    expect(panel.ownsToolStrip).toBe(true);
    expect(panel.dirty?.()).toBe(false);
  });

  it('publishesTheImagesFactsToTheWellStatusStripWhileActive', () => {
    const info: DocumentStatusInfo | null = TestBed.inject(DocumentStatus).info();

    expect(info?.language).toBe('GIF');
    expect(info?.details?.map((detail) => detail.text)).toEqual([
      'Editing flattens the animation',
      '40 × 30',
      '512 B',
      '100%',
    ]);
  });

  it('rendersTheImageWithItsToolStrip', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-image-toolstrip')).not.toBeNull();
    expect(element.querySelector('app-image-view img')).not.toBeNull();
  });

  it('toolStrip_drivesTheView', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const press: (label: string) => void = (label: string): void =>
      element.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();

    press('Zoom In');
    press('Dark Background');
    press('Rotate Right');
    fixture.detectChanges();

    const info: DocumentStatusInfo | null = TestBed.inject(DocumentStatus).info();
    expect(info?.details?.at(-1)?.text).toBe('125%');
    expect(element.querySelector('.image-view__stage--dark')).not.toBeNull();
  });

  it('openInTab_opensTheSameDocumentAsATopLevelTabAndRecordsIt', () => {
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('[aria-label="Open in Tab"]')
      ?.click();

    const tabs: Tabs = TestBed.inject(Tabs);
    expect(tabs.activeTab()?.type).toBe('image');
    const documents: ImageDocuments = TestBed.inject(ImageDocuments);
    expect(documents.forHolder(tabs.activeTabId()!)).toBe(documents.forHolder(panel.id));
    expect(TestBed.inject(RecentItems).items()[0]?.kind).toBe('image');
  });

  it('destroy_clearsTheStatusButKeepsTheHold', () => {
    fixture.destroy();

    expect(TestBed.inject(DocumentStatus).info()).toBeNull();
    expect(TestBed.inject(ImageDocuments).forHolder(panel.id)).toBeDefined();
  });

  it('releaseWellPanel_releasesTheHold', () => {
    TestBed.inject(ImageOpener).releaseWellPanel(panel.id);

    expect(TestBed.inject(ImageDocuments).forHolder(panel.id)).toBeUndefined();
  });
});
