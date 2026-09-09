import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  FileConflict,
  FileConflicts,
} from '@shared/angular/services/file-conflicts/file-conflicts';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { DocumentConflictModal } from './document-conflict-modal';

describe('DocumentConflictModal', () => {
  let component: DocumentConflictModal;
  let fixture: ComponentFixture<DocumentConflictModal>;
  let windows: FakeModalWindows;
  let activeConflict: WritableSignal<FileConflict | null>;
  let kept: string[];
  let reloaded: string[];

  /**
   * A representative pending conflict.
   */
  const conflict: FileConflict = { documentId: 'doc-1', tabId: 'tab-1', name: 'main.ts' };

  /**
   * Renders, then returns the content host of the window the modal opened. The prompt is
   * window-presented like every other modal, so its content is never in the fixture's own DOM.
   * @returns Returns the content host, or null when no window was opened.
   */
  async function present(): Promise<HTMLElement | null> {
    fixture.detectChanges();
    await fixture.whenStable();
    return windows.contentHost;
  }

  beforeEach(async () => {
    activeConflict = signal<FileConflict | null>(null);
    kept = [];
    reloaded = [];
    windows = new FakeModalWindows();
    const conflictsStub: Partial<FileConflicts> = {
      activeConflict,
      keep: (documentId: string): void => void kept.push(documentId),
      reload: (documentId: string): void => void reloaded.push(documentId),
    };

    await TestBed.configureTestingModule({
      imports: [DocumentConflictModal],
      providers: [
        { provide: FileConflicts, useValue: conflictsStub },
        { provide: ModalWindows, useValue: windows },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentConflictModal);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('render_whenTheActiveTabHasNoConflict_opensNoWindow', async () => {
    await present();

    // Mounted permanently and silent until the active tab has something to answer for. A conflict on
    // an inactive tab is signalled by that tab's attention dot, not by a window over this one.
    expect(windows.openWindows).toBe(0);
  });

  it('render_whenTheActiveTabHasAConflict_opensAWindowNamingTheFile', async () => {
    activeConflict.set(conflict);
    const host: HTMLElement | null = await present();

    expect(windows.openWindows).toBe(1);
    expect(host?.textContent).toContain('main.ts');
    expect(host?.textContent).toContain('File Changed on Disk');
  });

  it('render_asksForAWindowThatCannotBeDismissed', async () => {
    activeConflict.set(conflict);
    await present();

    // Both answers destroy something, so there is no third answer meaning "neither". A prompt that
    // could be waved away would leave the document in a state nothing later resolves.
    expect(windows.requests[0]?.closable).toBe(false);
  });

  it('keepButton_resolvesTheConflictKeepingTheEditorVersion', async () => {
    activeConflict.set(conflict);
    const host: HTMLElement | null = await present();

    host?.querySelectorAll<HTMLButtonElement>('button')[0]?.click();

    expect(kept).toEqual(['doc-1']);
    expect(reloaded).toEqual([]);
  });

  it('reloadButton_resolvesTheConflictReloadingFromDisk', async () => {
    activeConflict.set(conflict);
    const host: HTMLElement | null = await present();

    host?.querySelectorAll<HTMLButtonElement>('button')[1]?.click();

    expect(reloaded).toEqual(['doc-1']);
    expect(kept).toEqual([]);
  });

  it('render_whenTheConflictIsResolved_closesTheWindow', async () => {
    activeConflict.set(conflict);
    await present();

    activeConflict.set(null);
    await present();

    expect(windows.openWindows).toBe(0);
  });
});
