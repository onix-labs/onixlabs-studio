import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Settings } from '../../../../../services/settings/settings';
import { TextEditorSettingsSection } from './text-editor-settings';

describe('TextEditorSettingsSection', () => {
  let component: TextEditorSettingsSection;
  let fixture: ComponentFixture<TextEditorSettingsSection>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [TextEditorSettingsSection],
    }).compileComponents();

    fixture = TestBed.createComponent(TextEditorSettingsSection);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenProfileAdded_showsAnAccordion', async () => {
    const settings: Settings = TestBed.inject(Settings);
    settings.createProfile('TS', ['typescript']);
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('app-accordion').length).toBe(1);
  });

  it('render_whenProfileDoesNotOverride_leavesOverrideCheckboxesUnchecked', async () => {
    const settings: Settings = TestBed.inject(Settings);
    settings.createProfile('TS', ['typescript']);
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.accordion__header')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const checks: NodeListOf<HTMLInputElement> =
      element.querySelectorAll<HTMLInputElement>('.override__check input');
    expect(checks.length).toBeGreaterThan(0);
    expect(Array.from(checks).every((check: HTMLInputElement): boolean => !check.checked)).toBe(
      true,
    );
  });
});
