import { DebugElement } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { drainMilkdownTimers } from '../../../testing/drain-milkdown-timers';
import { stubCrepeEnvironment } from '../../../testing/stub-crepe-environment';
import { MarkdownEditor } from '../../markdown-editor/markdown-editor';
import { MarkdownField } from './markdown-field';

describe('MarkdownField', () => {
  let fixture: ComponentFixture<MarkdownField>;
  let component: MarkdownField;
  let host: HTMLElement;

  beforeAll(stubCrepeEnvironment);
  afterAll(drainMilkdownTimers);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownField],
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

  it('fill_marksTheHostToFillItsParent', async () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.classList.contains('markdown-field--fill')).toBe(false);

    fixture.componentRef.setInput('fill', true);
    fixture.detectChanges();

    expect(host.classList.contains('markdown-field--fill')).toBe(true);
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
});
