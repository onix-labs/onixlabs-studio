import { ApplicationRef, DebugElement } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';

import { drainMilkdownTimers } from '../../../testing/drain-milkdown-timers';
import { stubCrepeEnvironment } from '../../../testing/stub-crepe-environment';
import { MarkdownEditor } from '../../markdown-editor/markdown-editor';
import { MarkdownField } from './markdown-field';

describe('MarkdownField', () => {
  let fixture: ComponentFixture<MarkdownField>;
  let component: MarkdownField;
  let host: HTMLElement;
  let windows: FakeModalWindows;

  beforeAll(stubCrepeEnvironment);
  afterAll(drainMilkdownTimers);

  beforeEach(async () => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [MarkdownField],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();
    fixture = TestBed.createComponent(MarkdownField);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('render_always_framesAnInsetEditorAndNamesTheField', async () => {
    fixture.componentRef.setInput('ariaLabel', 'System prompt');
    fixture.componentRef.setInput('minRows', 8);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.getAttribute('role')).toBe('group');
    expect(host.getAttribute('aria-label')).toBe('System prompt');
    expect(host.style.getPropertyValue('--markdown-field-min-rows')).toBe('8');
    const editor: HTMLElement | null = host.querySelector('app-markdown-editor');
    expect(editor?.classList.contains('markdown-editor--inset')).toBe(true);
  });

  it('value_whenGiven_seedsTheEditor_andEditsReportThroughTheModel', async () => {
    fixture.componentRef.setInput('value', '# Heading\n\nBody.');
    fixture.detectChanges();
    const editor: MarkdownEditor = fixture.debugElement.query(
      (node: DebugElement): boolean => node.componentInstance instanceof MarkdownEditor,
    ).componentInstance as MarkdownEditor;
    await new Promise<void>((resolve: () => void): void => void editor.ready.subscribe(resolve));

    expect(editor.getCrepe()?.getMarkdown()).toContain('# Heading');

    const emitted: string[] = [];
    component.value.subscribe((value: string): void => void emitted.push(value));
    editor.contentChange.emit('# Heading\n\nEdited.');

    expect(emitted).toEqual(['# Heading\n\nEdited.']);
    expect(component.value()).toBe('# Heading\n\nEdited.');
  });

  /**
   * Flushes change detection through the field and the modal window's attached view.
   */
  function flush(): void {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  }

  it('edit_whenClicked_opensAWindowHeadedByTheFieldsName', async () => {
    fixture.componentRef.setInput('ariaLabel', 'System prompt');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(windows.openWindows).toBe(0);

    host.querySelector<HTMLButtonElement>('.markdown-field__actions button')?.click();
    flush();

    expect(windows.openWindows).toBe(1);
    expect(windows.contentHost?.querySelector('.markdown-field__modal-title')?.textContent).toBe(
      'Edit System prompt',
    );
    expect(windows.contentHost?.querySelector('app-markdown-editor')).not.toBeNull();
  });

  it('edit_whenApplied_writesTheDraftToTheField_andWhenCancelled_leavesIt', async () => {
    fixture.componentRef.setInput('value', 'original');
    fixture.detectChanges();
    await fixture.whenStable();
    const field: { onDraftChange(markdown: string): void } = component as unknown as {
      onDraftChange(markdown: string): void;
    };
    const buttons: () => HTMLButtonElement[] = (): HTMLButtonElement[] =>
      Array.from(windows.contentHost?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const button: (label: string) => HTMLButtonElement | undefined = (
      label: string,
    ): HTMLButtonElement | undefined =>
      buttons().find((b: HTMLButtonElement): boolean => b.textContent?.trim() === label);

    host.querySelector<HTMLButtonElement>('.markdown-field__actions button')?.click();
    flush();
    field.onDraftChange('changed');
    button('Cancel')?.click();
    flush();
    expect(component.value()).toBe('original');
    expect(windows.openWindows).toBe(0);

    host.querySelector<HTMLButtonElement>('.markdown-field__actions button')?.click();
    flush();
    field.onDraftChange('changed');
    button('Apply')?.click();
    flush();
    expect(component.value()).toBe('changed');
    expect(windows.openWindows).toBe(0);
  });
});
