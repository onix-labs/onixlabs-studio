import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Settings } from '@shared/angular/services/settings/settings';
import { LanguageEditorOverrides } from './language-editor-overrides';

describe('LanguageEditorOverrides', () => {
  let component: LanguageEditorOverrides;
  let fixture: ComponentFixture<LanguageEditorOverrides>;
  let settings: Settings;
  let element: HTMLElement;

  /**
   * Gets the Override tick boxes, one per overridable setting in registry order.
   * @returns Returns the native checkboxes.
   */
  function checks(): HTMLInputElement[] {
    return Array.from(element.querySelectorAll<HTMLInputElement>('.override__check input'));
  }

  /**
   * Ticks or unticks an Override box the way a user would.
   * @param index The row index.
   * @param checked The new state.
   */
  async function tick(index: number, checked: boolean): Promise<void> {
    const check: HTMLInputElement = checks()[index];
    check.checked = checked;
    check.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [LanguageEditorOverrides],
    }).compileComponents();

    fixture = TestBed.createComponent(LanguageEditorOverrides);
    fixture.componentRef.setInput('language', 'rust');
    fixture.componentRef.setInput('languageName', 'Rust');
    component = fixture.componentInstance;
    settings = TestBed.inject(Settings);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_always_namesTheLanguageAndRendersARowPerOverridableSetting', () => {
    expect(element.querySelector('.language-editor-overrides__subtitle')?.textContent).toContain(
      'Rust files',
    );
    expect(element.querySelectorAll('app-setting-row').length).toBe(9);
    expect(checks().every((check: HTMLInputElement): boolean => !check.checked)).toBe(true);
  });

  /**
   * Gets the Tab size row's dropdown (the second overridable setting, a select).
   * @returns Returns the native select.
   */
  function tabSizeSelect(): HTMLSelectElement {
    const select: HTMLSelectElement | null = element
      .querySelectorAll('app-setting-row')[1]
      .querySelector<HTMLSelectElement>('app-dropdown select');
    if (select === null) {
      throw new Error('The Tab size row has no dropdown.');
    }
    return select;
  }

  it('render_whenNothingOverridden_disablesEveryControlAndShowsTheGlobalValue', () => {
    settings.updateTextEditorSettings({ tabSize: 8 });
    fixture.detectChanges();

    expect(tabSizeSelect().disabled).toBe(true);
    expect(tabSizeSelect().value).toBe('8');
  });

  it('onOverrideToggle_whenTicked_seedsTheOverrideFromTheGlobalValueAndEnablesTheControl', async () => {
    settings.updateTextEditorSettings({ tabSize: 8 });
    fixture.detectChanges();

    await tick(1, true);

    expect(settings.languageOverrides()).toEqual({ rust: { tabSize: 8 } });
    expect(tabSizeSelect().disabled).toBe(false);
  });

  it('onOverrideValue_whenControlChanged_recordsTheLanguageValueOnly', async () => {
    await tick(1, true);

    tabSizeSelect().value = '4';
    tabSizeSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // Stored as a number, as the global setting is — not the dropdown's string pick.
    expect(settings.languageOverrides()).toEqual({ rust: { tabSize: 4 } });
    expect(settings.globalTextEditor().tabSize).toBe(2);
    expect(settings.resolveSettingsForLanguage('rust').tabSize).toBe(4);
  });

  it('onOverrideToggle_whenUnticked_returnsTheLanguageToGlobal', async () => {
    await tick(1, true);
    await tick(1, false);

    expect(settings.languageOverrides()).toEqual({});
    expect(checks()[1].checked).toBe(false);
  });

  it('render_whenLanguageInputChanges_showsThatLanguagesOverrides', async () => {
    settings.setLanguageOverride('go', 'tabSize', 8);
    await tick(1, true);
    expect(checks()[1].checked).toBe(true);

    fixture.componentRef.setInput('language', 'go');
    fixture.componentRef.setInput('languageName', 'Go');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(checks()[1].checked).toBe(true);
    expect(tabSizeSelect().value).toBe('8');

    fixture.componentRef.setInput('language', 'python');
    fixture.detectChanges();
    expect(checks()[1].checked).toBe(false);
  });
});
