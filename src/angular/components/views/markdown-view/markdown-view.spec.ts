import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownView } from './markdown-view';

describe('MarkdownView', () => {
  let component: MarkdownView;
  let fixture: ComponentFixture<MarkdownView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownView],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
