import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownRibbon } from './markdown-ribbon';

describe('MarkdownRibbon', () => {
  let component: MarkdownRibbon;
  let fixture: ComponentFixture<MarkdownRibbon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownRibbon],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownRibbon);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
