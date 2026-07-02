import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CodeDocumentEditor } from './code-document';

describe('CodeDocumentEditor', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeDocumentEditor],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Monaco editor is not booted:
  // the code editor depends on browser layout APIs that the jsdom test environment does not provide.
  // This keeps the smoke test to the component's own wiring. The required document id is set so the
  // component's own lifecycle (which reads it on teardown) has a value.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ComponentFixture<CodeDocumentEditor> =
      TestBed.createComponent(CodeDocumentEditor);
    fixture.componentRef.setInput('documentId', 'test-document');
    expect(fixture.componentInstance).toBeTruthy();
  });
});
