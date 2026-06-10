import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CodeView } from './code-view';

describe('CodeView', () => {
  let component: CodeView;
  let fixture: ComponentFixture<CodeView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeView],
    }).compileComponents();

    fixture = TestBed.createComponent(CodeView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
