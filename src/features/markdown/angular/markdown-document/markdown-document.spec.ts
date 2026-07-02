import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownDocument } from './markdown-document';

describe('MarkdownDocument', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownDocument],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Crepe editor is not booted:
  // the WYSIWYG editor depends on browser layout APIs that the jsdom test environment does not
  // provide. This keeps the smoke test to the component's own wiring. The required document id is set
  // so the component's own lifecycle (which reads it on teardown) has a value.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ComponentFixture<MarkdownDocument> = TestBed.createComponent(MarkdownDocument);
    fixture.componentRef.setInput('documentId', 'test-document');
    expect(fixture.componentInstance).toBeTruthy();
  });
});
