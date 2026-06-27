import { TestBed } from '@angular/core/testing';

import { SourceControlView } from './source-control-view';

describe('SourceControlView', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SourceControlView],
    }).compileComponents();
  });

  // The component is constructed without running change detection so the embedded Monaco diff editor
  // is not booted: Monaco loads its editor over an AMD loader script and browser layout APIs the jsdom
  // test environment does not provide. This keeps the smoke test to the component's own wiring.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ReturnType<typeof TestBed.createComponent<SourceControlView>> =
      TestBed.createComponent(SourceControlView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    expect(fixture.componentInstance).toBeTruthy();
  });
});
