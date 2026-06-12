import { TestBed } from '@angular/core/testing';

import { CodeView } from './code-view';

describe('CodeView', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeView],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Monaco editor is not booted:
  // Monaco loads its editor over an AMD loader script and browser layout APIs that the jsdom test
  // environment does not provide. This keeps the smoke test to the component's own wiring.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ReturnType<typeof TestBed.createComponent<CodeView>> =
      TestBed.createComponent(CodeView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    expect(fixture.componentInstance).toBeTruthy();
  });
});
