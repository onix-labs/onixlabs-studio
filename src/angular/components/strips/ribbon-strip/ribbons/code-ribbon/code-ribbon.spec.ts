import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CodeRibbon } from './code-ribbon';

describe('CodeRibbon', () => {
  let component: CodeRibbon;
  let fixture: ComponentFixture<CodeRibbon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeRibbon],
    }).compileComponents();

    fixture = TestBed.createComponent(CodeRibbon);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
