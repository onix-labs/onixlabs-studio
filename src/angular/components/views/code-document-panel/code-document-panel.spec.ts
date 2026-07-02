import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CodeDocumentPanel } from './code-document-panel';

describe('CodeDocumentPanel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeDocumentPanel],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Monaco editor is not booted:
  // the code editor depends on browser layout APIs that the jsdom test environment does not provide.
  // This keeps the smoke test to the component's own wiring.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ComponentFixture<CodeDocumentPanel> = TestBed.createComponent(CodeDocumentPanel);
    fixture.componentRef.setInput('documentId', 'test-document');
    expect(fixture.componentInstance).toBeTruthy();
  });
});
