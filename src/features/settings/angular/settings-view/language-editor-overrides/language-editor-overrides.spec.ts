import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WritableSignal } from '@angular/core';
import type { LspServerSummary } from '@shared/api/lsp-channels';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { Settings } from '@shared/angular/services/settings/settings';
import { LanguageEditorOverrides } from './language-editor-overrides';

/**
 * The language overrides Studio ships with: C# braces on their own line (#1177).
 */
const CSHARP_ALLMAN: Record<string, unknown> = { csharp: { braceStyle: 'allman' } };

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
    // Nine overridable settings, Format on Type (#1141) among them; Line Height is global only.
    expect(element.querySelectorAll('app-setting-row').length).toBe(9);
    expect(checks().every((check: HTMLInputElement): boolean => !check.checked)).toBe(true);
  });

  /**
   * Finds the Tab Size row's position among the rows, by its title rather than its place in the
   * registry order.
   * @returns Returns the row's index.
   */
  function tabSizeIndex(): number {
    return Array.from(element.querySelectorAll('app-setting-row')).findIndex(
      (row: Element): boolean =>
        row.querySelector('.setting-row__label')?.textContent?.trim() === 'Tab Size',
    );
  }

  /**
   * Gets the Tab Size row's dropdown.
   * @returns Returns the native select.
   */
  function tabSizeSelect(): HTMLSelectElement {
    const row: Element = element.querySelectorAll('app-setting-row')[tabSizeIndex()];
    const select: HTMLSelectElement | null =
      row.querySelector<HTMLSelectElement>('app-dropdown select');
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

    await tick(tabSizeIndex(), true);

    expect(settings.languageOverrides()).toEqual({ ...CSHARP_ALLMAN, rust: { tabSize: 8 } });
    expect(tabSizeSelect().disabled).toBe(false);
  });

  it('onOverrideValue_whenControlChanged_recordsTheLanguageValueOnly', async () => {
    await tick(tabSizeIndex(), true);

    tabSizeSelect().value = '4';
    tabSizeSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // Stored as a number, as the global setting is — not the dropdown's string pick.
    expect(settings.languageOverrides()).toEqual({ ...CSHARP_ALLMAN, rust: { tabSize: 4 } });
    expect(settings.globalTextEditor().tabSize).toBe(2);
    expect(settings.resolveSettingsForLanguage('rust').tabSize).toBe(4);
  });

  it('onOverrideToggle_whenUnticked_returnsTheLanguageToGlobal', async () => {
    await tick(tabSizeIndex(), true);
    await tick(tabSizeIndex(), false);

    expect(settings.languageOverrides()).toEqual(CSHARP_ALLMAN);
    expect(checks()[tabSizeIndex()].checked).toBe(false);
  });

  it('render_whenLanguageInputChanges_showsThatLanguagesOverrides', async () => {
    settings.setLanguageOverride('go', 'tabSize', 8);
    await tick(tabSizeIndex(), true);
    expect(checks()[tabSizeIndex()].checked).toBe(true);

    fixture.componentRef.setInput('language', 'go');
    fixture.componentRef.setInput('languageName', 'Go');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(checks()[tabSizeIndex()].checked).toBe(true);
    expect(tabSizeSelect().value).toBe('8');

    fixture.componentRef.setInput('language', 'python');
    fixture.detectChanges();
    expect(checks()[tabSizeIndex()].checked).toBe(false);
  });

  /**
   * Gets the titles of the rendered rows.
   * @returns Returns the titles, in order.
   */
  function titles(): string[] {
    return Array.from(element.querySelectorAll('.setting-row__label')).map(
      (label: Element): string => label.textContent?.trim() ?? '',
    );
  }

  it('section_showsOnlyThatPagesOverridableSettings', async () => {
    fixture.componentRef.setInput('section', 'code-appearance');
    await fixture.whenStable();
    expect(titles()).toEqual(['Line Numbers', 'Minimap', 'Coloured Brackets', 'Sticky Scroll']);
    expect(element.textContent).toContain('untick to follow Code › Appearance');

    fixture.componentRef.setInput('section', 'code-editing');
    await fixture.whenStable();
    expect(titles()).toEqual([
      'Tab Size',
      'Insert Spaces',
      'Word Wrap',
      'Format on Type',
      'Brace Style',
    ]);
  });

  it('braceStyle_whenTheLanguagesServerDoesNotTakeIt_saysSo', async () => {
    fixture.componentRef.setInput('section', 'code-editing');
    const lsp: LspSettings = TestBed.inject(LspSettings);
    const registered: WritableSignal<readonly LspServerSummary[]> = (
      lsp as unknown as { registered: WritableSignal<readonly LspServerSummary[]> }
    ).registered;
    registered.set([
      { id: 'rust', displayName: 'rust-analyzer', priority: 100, languages: ['rust'] },
    ]);
    await fixture.whenStable();
    expect(element.textContent).toContain("Not supported by this language's server yet.");

    registered.set([
      {
        id: 'rust',
        displayName: 'rust-analyzer',
        priority: 100,
        languages: ['rust'],
        takesBraceStyle: true,
      },
    ]);
    await fixture.whenStable();
    expect(element.textContent).not.toContain('Not supported');
  });
});
