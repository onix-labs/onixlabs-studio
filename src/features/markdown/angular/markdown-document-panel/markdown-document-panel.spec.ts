import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownDocumentPanel } from './markdown-document-panel';

describe('MarkdownDocumentPanel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownDocumentPanel],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Crepe editor is not booted:
  // the WYSIWYG editor depends on browser layout APIs that the jsdom test environment does not
  // provide. This keeps the smoke test to the component's own wiring.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ComponentFixture<MarkdownDocumentPanel> =
      TestBed.createComponent(MarkdownDocumentPanel);
    fixture.componentRef.setInput('documentId', 'test-document');
    expect(fixture.componentInstance).toBeTruthy();
  });
});
