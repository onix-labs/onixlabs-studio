import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Printing, PrintPreparer } from '@shared/angular/services/printing/printing';
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

  it('print_whenNotTheActiveDocument_leavesThePrintToTheOneThatIs', () => {
    // Every open code document registers to fill its print mirror, but only the active one prints.
    const preparers: PrintPreparer[] = [];
    vi.spyOn(TestBed.inject(Printing), 'registerPreparer').mockImplementation(
      (preparer: PrintPreparer): (() => void) => {
        preparers.push(preparer);
        return (): void => undefined;
      },
    );
    const fixture: ComponentFixture<CodeDocumentEditor> =
      TestBed.createComponent(CodeDocumentEditor);
    fixture.componentRef.setInput('documentId', 'test-document');

    expect(preparers.length).toBe(1);
    expect(preparers[0]()).toBeUndefined();
  });

  it('destroy_unregistersThePrintPreparer', () => {
    const unregister: ReturnType<typeof vi.fn<() => void>> = vi.fn<() => void>();
    vi.spyOn(TestBed.inject(Printing), 'registerPreparer').mockReturnValue(unregister);
    const fixture: ComponentFixture<CodeDocumentEditor> =
      TestBed.createComponent(CodeDocumentEditor);
    fixture.componentRef.setInput('documentId', 'test-document');

    fixture.destroy();

    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
