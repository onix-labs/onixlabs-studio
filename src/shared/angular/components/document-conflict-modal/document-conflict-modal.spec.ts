import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  FileConflict,
  FileConflicts,
} from '@shared/angular/services/file-conflicts/file-conflicts';
import { DocumentConflictModal } from './document-conflict-modal';

describe('DocumentConflictModal', () => {
  let component: DocumentConflictModal;
  let fixture: ComponentFixture<DocumentConflictModal>;
  let host: HTMLElement;
  let activeConflict: WritableSignal<FileConflict | null>;
  let kept: string[];
  let reloaded: string[];

  /**
   * A representative pending conflict.
   */
  const conflict: FileConflict = { documentId: 'doc-1', tabId: 'tab-1', name: 'main.ts' };

  beforeEach(async () => {
    activeConflict = signal<FileConflict | null>(null);
    kept = [];
    reloaded = [];
    const conflictsStub: Partial<FileConflicts> = {
      activeConflict,
      keep: (documentId: string): void => void kept.push(documentId),
      reload: (documentId: string): void => void reloaded.push(documentId),
    };

    await TestBed.configureTestingModule({
      imports: [DocumentConflictModal],
      providers: [{ provide: FileConflicts, useValue: conflictsStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentConflictModal);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('render_whenTheActiveTabHasNoConflict_showsNothing', () => {
    fixture.detectChanges();

    expect(host.querySelector('.overlay')).toBeNull();
  });

  it('render_whenTheActiveTabHasAConflict_showsTheDialogNamingTheFile', () => {
    activeConflict.set(conflict);
    fixture.detectChanges();

    const dialog: HTMLElement | null = host.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('main.ts');
    expect(dialog?.textContent).toContain('File Changed on Disk');
  });

  it('keepButton_resolvesTheConflictKeepingTheEditorVersion', () => {
    activeConflict.set(conflict);
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('.btn:not(.btn--danger)')?.click();

    expect(kept).toEqual(['doc-1']);
    expect(reloaded).toEqual([]);
  });

  it('reloadButton_resolvesTheConflictReloadingFromDisk', () => {
    activeConflict.set(conflict);
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('.btn--danger')?.click();

    expect(reloaded).toEqual(['doc-1']);
    expect(kept).toEqual([]);
  });
});
