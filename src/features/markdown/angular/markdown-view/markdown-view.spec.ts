import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownView } from './markdown-view';

describe('MarkdownView', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownView],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Crepe editor is not booted:
  // the WYSIWYG editor depends on browser layout APIs that the jsdom test environment does not
  // provide. This keeps the smoke test to the component's own wiring. The required `tabId` input is
  // supplied (setInput does not trigger change detection, so the editor still stays down) so the
  // teardown's ngOnDestroy — which reads `tabId()` to drop the document's panel state — does not throw
  // NG0950.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ComponentFixture<MarkdownView> = TestBed.createComponent(MarkdownView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const component: MarkdownView = fixture.componentInstance;
    expect(component).toBeTruthy();
  });
});
