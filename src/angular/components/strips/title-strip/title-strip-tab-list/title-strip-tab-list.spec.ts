import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TitleStripTabList } from './title-strip-tab-list';

describe('TitleStripTabList', () => {
  let component: TitleStripTabList;
  let fixture: ComponentFixture<TitleStripTabList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripTabList],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripTabList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
