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

  it('render_whenAProseDocumentPublishes_showsWordCountAndReadTimeWithoutCodeSegments', () => {
    documentStatus.set('owner', {
      words: 532,
      readMinutes: 3,
      language: 'markdown',
      encoding: 'UTF-8',
    });
    fixture.detectChanges();

    const text: string = host.textContent ?? '';
    expect(text).toContain('532 words');
    expect(text).toContain('3 min read');
    expect(text).toContain('markdown');
    expect(text).toContain('UTF-8');
    expect(text).not.toContain('Ln ');
    expect(text).not.toContain('100%');
  });

  it('render_whenAProseDocumentIsEmpty_hidesTheReadTime', () => {
    documentStatus.set('owner', { words: 0, readMinutes: 0, language: 'markdown' });
    fixture.detectChanges();

    const text: string = host.textContent ?? '';
    expect(text).toContain('0 words');
    expect(text).not.toContain('min read');
  });

  it('render_whenAComparisonPublishes_showsTheCountPositionAndLineTally', () => {
    documentStatus.set('owner', {
      language: 'markdown',
      changes: 12,
      currentChange: 3,
      linesAdded: 40,
      linesRemoved: 7,
    });
    fixture.detectChanges();

    const text: string = host.textContent ?? '';
    expect(text).toContain('12 changes');
    expect(text).toContain('Viewing 3 of 12');
    // The signs are glyphs now, so the tally is read off its own segments.
    expect(host.querySelector('.dock-status-strip__added')?.textContent).toBeDefined();
    expect(
      Array.from(host.querySelectorAll('.dock-status-strip__added')).map(
        (element: Element): string => element.textContent ?? '',
      ),
    ).toContain('40');
    expect(
      Array.from(host.querySelectorAll('.dock-status-strip__removed')).map(
        (element: Element): string => element.textContent ?? '',
      ),
    ).toContain('7');
    // A comparison has no caret segment and no zoom: neither is published, so neither is drawn.
    expect(text).not.toContain('Ln ');
    expect(text).not.toContain('100%');
  });

  it('render_whenAComparisonPublishes_dropsTheDiagnosticsSegment', () => {
    // Workspace counts, identical on every tab, saying nothing about the two versions on screen.
    documentStatus.set('owner', { language: 'markdown', changes: 12, linesAdded: 1 });
    fixture.detectChanges();

    expect(host.querySelector('[title="Errors and warnings"]')).toBeNull();
  });

  it('render_whenAnOrdinaryDocumentPublishes_keepsTheDiagnosticsSegment', () => {
    documentStatus.set('owner', info);
    fixture.detectChanges();

    expect(host.querySelector('[title="Errors and warnings"]')).not.toBeNull();
  });

  it('render_theLineTallyIsHeldToTheTrailingEdge', () => {
    documentStatus.set('owner', { language: 'markdown', changes: 12, linesAdded: 40 });
    fixture.detectChanges();

    const groups: NodeListOf<Element> = host.querySelectorAll('.dock-status-strip__group');
    expect(groups[groups.length - 1].classList).toContain('dock-status-strip__group--end');
  });

  it('render_whenTheCaretIsAboveTheFirstChange_omitsThePosition', () => {
    documentStatus.set('owner', {
      language: 'markdown',
      changes: 12,
      linesAdded: 40,
      linesRemoved: 7,
    });
    fixture.detectChanges();

    const text: string = host.textContent ?? '';
    expect(text).toContain('12 changes');
    expect(text).not.toContain('Viewing');
  });

  it('render_whenAComparisonHasNoChanges_stillSaysSo', () => {
    // "No changes" is the answer to the question the strip is being asked, and is quite different
    // from a document that is not a comparison at all.
    documentStatus.set('owner', {
      language: 'markdown',
      changes: 0,
      linesAdded: 0,
      linesRemoved: 0,
    });
    fixture.detectChanges();

    expect(host.textContent).toContain('0 changes');
    // Nothing added and nothing removed, so the tally has nothing to tally.
    expect(host.querySelector('.dock-status-strip__group--end')).toBeNull();
  });

  it('render_whenOneRegionChanged_saysChangeRatherThanChanges', () => {
    documentStatus.set('owner', { language: 'markdown', changes: 1, currentChange: 1 });
    fixture.detectChanges();

    expect(host.textContent).toContain('1 change');
    expect(host.textContent).not.toContain('1 changes');
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
