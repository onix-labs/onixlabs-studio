import { TestBed } from '@angular/core/testing';

import { MarkdownView } from './markdown-view';

describe('MarkdownView', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownView],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Crepe editor is not booted:
  // the WYSIWYG editor depends on browser layout APIs that the jsdom test environment does not
  // provide. This keeps the smoke test to the component's own wiring.
  it('create_whenConstructed_returnsComponent', () => {
    const component: MarkdownView = TestBed.createComponent(MarkdownView).componentInstance;
    expect(component).toBeTruthy();
  });
});
