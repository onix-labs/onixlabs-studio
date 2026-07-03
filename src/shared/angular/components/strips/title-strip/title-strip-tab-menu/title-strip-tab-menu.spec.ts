import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TitleStripTabMenu } from './title-strip-tab-menu';

describe('TitleStripTabMenu', () => {
  let component: TitleStripTabMenu;
  let fixture: ComponentFixture<TitleStripTabMenu>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripTabMenu],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripTabMenu);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
