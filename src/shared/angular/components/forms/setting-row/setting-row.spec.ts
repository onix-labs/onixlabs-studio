import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingRow } from './setting-row';

describe('SettingRow', () => {
  let component: SettingRow;
  let fixture: ComponentFixture<SettingRow>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingRow],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingRow);
    fixture.componentRef.setInput('label', 'Word Wrap');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenDescriptionSet_showsTheDescription', () => {
    fixture.componentRef.setInput('description', 'Wrap long lines');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.setting-row__description')?.textContent).toContain(
      'Wrap long lines',
    );
  });

  it('render_whenDescriptionEmpty_omitsTheDescription', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.setting-row__description')).toBeNull();
  });
});
