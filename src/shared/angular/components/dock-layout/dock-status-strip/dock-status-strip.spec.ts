import { Signal, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Diagnostics } from '@shared/angular/services/diagnostics/diagnostics';
import {
  DocumentStatus,
  DocumentStatusInfo,
} from '@shared/angular/services/document-status/document-status';
import { EditorZoom } from '@shared/angular/services/editor-zoom/editor-zoom';
import { DockStatusStrip } from './dock-status-strip';

describe('DockStatusStrip', () => {
  let component: DockStatusStrip;
  let fixture: ComponentFixture<DockStatusStrip>;
  let host: HTMLElement;
  let errorCount: WritableSignal<number>;
  let warningCount: WritableSignal<number>;
  let documentStatus: DocumentStatus;
  let editorZoom: EditorZoom;

  /**
   * A representative document status publication.
   */
  const info: DocumentStatusInfo = {
    line: 12,
    column: 4,
    language: 'typescript',
    eol: 'LF',
    encoding: 'UTF-8',
  };

  beforeEach(async () => {
    errorCount = signal<number>(0);
    warningCount = signal<number>(0);

    await TestBed.configureTestingModule({
      imports: [DockStatusStrip],
      // The real Diagnostics aggregate pulls in Monaco; only its counts matter here.
      providers: [{ provide: Diagnostics, useValue: { errorCount, warningCount } }],
    }).compileComponents();

    documentStatus = TestBed.inject(DocumentStatus);
    editorZoom = TestBed.inject(EditorZoom);
    fixture = TestBed.createComponent(DockStatusStrip);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('render_showsTheErrorAndWarningCounts', () => {
    errorCount.set(2);
    warningCount.set(5);
    fixture.detectChanges();

    const segment: HTMLElement | null = host.querySelector<HTMLElement>(
      '.dock-status-strip__segment',
    );
    expect(segment?.textContent).toContain('2');
    expect(segment?.textContent).toContain('5');
  });

  it('render_whenNoDocumentPublishes_hidesTheDocumentGroup', () => {
    fixture.detectChanges();

    expect(host.querySelectorAll('.dock-status-strip__group').length).toBe(1);
  });

  it('render_whenADocumentPublishes_showsCaretLanguageEolEncodingAndZoom', () => {
    documentStatus.set('owner', info);
    fixture.detectChanges();

    const text: string = host.textContent ?? '';
    expect(text).toContain('Ln 12, Col 4');
    expect(text).toContain('typescript');
    expect(text).toContain('LF');
    expect(text).toContain('UTF-8');
    expect(text).toContain('100%');
  });

  it('setZoom_setsTheGlobalEditorZoomAndTheShownPercentage', () => {
    documentStatus.set('owner', info);
    fixture.detectChanges();

    (component as unknown as { setZoom(id: string): void }).setZoom('150');
    fixture.detectChanges();

    expect(editorZoom.percent()).toBe(150);
    expect(host.textContent).toContain('150%');
  });

  it('zoomItems_markTheCurrentLevelActive', () => {
    editorZoom.set(75);
    fixture.detectChanges();

    const items: readonly MenuItem[] = (
      component as unknown as { zoomItems: Signal<readonly MenuItem[]> }
    ).zoomItems();
    const active: readonly MenuItem[] = items.filter(
      (item: MenuItem): boolean => item.active === true,
    );
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('75');
    expect(active[0].label).toBe('75%');
  });
});
