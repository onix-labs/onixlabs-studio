import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownSettings } from './markdown-settings';

describe('MarkdownSettings', () => {
  let component: MarkdownSettings;
  let fixture: ComponentFixture<MarkdownSettings>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [MarkdownSettings],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownSettings);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_rendersASettingRowPerControl', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('app-setting-row').length).toBe(5);
  });
});
