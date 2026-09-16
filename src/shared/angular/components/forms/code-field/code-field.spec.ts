import { DebugElement } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { TextEditor } from '@shared/angular/components/text-editor/text-editor';
import { CodeField } from './code-field';

describe('CodeField', () => {
  let fixture: ComponentFixture<CodeField>;
  let component: CodeField;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CodeField] }).compileComponents();
    fixture = TestBed.createComponent(CodeField);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
  });

  /**
   * Finds the framed text editor.
   * @returns Returns the editor component.
   */
  function editor(): TextEditor {
    return fixture.debugElement.query(
      (node: DebugElement): boolean => node.componentInstance instanceof TextEditor,
    ).componentInstance as TextEditor;
  }

  it('render_always_framesATextEditorAndNamesTheField', async () => {
    fixture.componentRef.setInput('ariaLabel', 'Request body');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.getAttribute('role')).toBe('group');
    expect(host.getAttribute('aria-label')).toBe('Request body');
    expect(host.querySelector('.code-field__frame app-text-editor')).not.toBeNull();
  });

  it('language_whenGiven_reachesTheEditor_andCanChange', async () => {
    fixture.componentRef.setInput('language', 'json');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(editor().language()).toBe('json');

    fixture.componentRef.setInput('language', 'xml');
    fixture.detectChanges();
    expect(editor().language()).toBe('xml');
  });

  it('readOnly_orDisabled_makesTheEditorReadOnly', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(editor().readOnly()).toBe(false);

    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    expect(editor().readOnly()).toBe(true);
    expect(host.classList.contains('code-field--read-only')).toBe(true);

    fixture.componentRef.setInput('readOnly', false);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(editor().readOnly()).toBe(true);
    expect(host.classList.contains('code-field--disabled')).toBe(true);
  });

  it('value_whenGiven_seedsTheEditor_andEditsReportThroughTheModel', async () => {
    fixture.componentRef.setInput('value', '{"a":1}');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(editor().content()).toBe('{"a":1}');

    const emitted: string[] = [];
    component.value.subscribe((value: string): void => void emitted.push(value));
    editor().contentChange.emit('{"a":2}');

    expect(emitted).toEqual(['{"a":2}']);
    expect(component.value()).toBe('{"a":2}');
  });

  it('frame_beforeTheEditorReports_isDrawnAtItsMinimumRows', async () => {
    fixture.componentRef.setInput('minRows', 4);
    fixture.detectChanges();
    await fixture.whenStable();

    // Monaco does not load under the test runner, so the frame sits at its floor: four rows of the
    // fallback line height plus the editor's padding above and below.
    const frame: HTMLElement | null = host.querySelector('.code-field__frame');
    expect(frame?.style.blockSize).toBe(`${4 * 19 + 16}px`);
  });

  it('fill_whenSet_dropsTheBoundHeight_andMarksTheHost', async () => {
    fixture.componentRef.setInput('fill', true);
    fixture.detectChanges();
    await fixture.whenStable();

    const frame: HTMLElement | null = host.querySelector('.code-field__frame');
    expect(frame?.style.blockSize).toBe('');
    expect(host.classList.contains('code-field--fill')).toBe(true);
  });

  it('frame_whenMaxRowsIsBelowMinRows_neverShrinksBelowTheMinimum', async () => {
    fixture.componentRef.setInput('minRows', 6);
    fixture.componentRef.setInput('maxRows', 2);
    fixture.detectChanges();
    await fixture.whenStable();

    const frame: HTMLElement | null = host.querySelector('.code-field__frame');
    expect(frame?.style.blockSize).toBe(`${6 * 19 + 16}px`);
  });
});
