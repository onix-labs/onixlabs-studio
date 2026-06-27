import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SourceControlRibbon } from './source-control-ribbon';

describe('SourceControlRibbon', () => {
  let component: SourceControlRibbon;
  let fixture: ComponentFixture<SourceControlRibbon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SourceControlRibbon],
    }).compileComponents();

    fixture = TestBed.createComponent(SourceControlRibbon);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
