import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ContentHost } from './content-host';

describe('ContentHost', () => {
  let component: ContentHost;
  let fixture: ComponentFixture<ContentHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContentHost],
    }).compileComponents();

    fixture = TestBed.createComponent(ContentHost);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
