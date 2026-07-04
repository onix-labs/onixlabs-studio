import { TestBed } from '@angular/core/testing';

import { MarkdownEditor } from './markdown-editor';

describe('MarkdownEditor', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownEditor],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Crepe editor is not booted:
  // the WYSIWYG editor depends on browser layout APIs that the jsdom test environment does not
  // provide. This keeps the smoke test to the component's own wiring, and leaves the imperative API
  // null-safe before creation.
  it('create_whenConstructed_returnsComponent', () => {
    const component: MarkdownEditor = TestBed.createComponent(MarkdownEditor).componentInstance;
    expect(component).toBeTruthy();
    expect(component.getCrepe()).toBeNull();
    expect(component.getEditorView()).toBeNull();
    expect(component.getMarkdown()).toBe('');
  });
});
