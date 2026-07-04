import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DirectoryRibbon } from './directory-ribbon';

describe('DirectoryRibbon', () => {
  let component: DirectoryRibbon;
  let fixture: ComponentFixture<DirectoryRibbon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DirectoryRibbon],
    }).compileComponents();

    fixture = TestBed.createComponent(DirectoryRibbon);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
