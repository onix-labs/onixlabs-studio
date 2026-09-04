import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Display } from '@shared/angular/services/display/display';
import { findSection } from '@shared/angular/services/settings/settings-registry';
import { Settings } from '@shared/angular/services/settings/settings';
import { ACCENT_PRESETS } from '@shared/angular/services/theme/theme';
import { SettingsSection } from './settings-section';

describe('SettingsSection', () => {
  let fixture: ComponentFixture<SettingsSection>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [SettingsSection],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsSection);
  });

  afterEach(() => {
    // The Display service writes these to the shared document root; specs run without isolation, so
    // leaving them set would follow the suite into the next file.
    document.documentElement.removeAttribute('data-corners');
    document.documentElement.removeAttribute('data-reduced-gpu');
  });

  /**
   * Renders the section identified by the given id.
   * @param id The section identifier to render.
   */
  async function render(id: string): Promise<HTMLElement> {
    fixture.componentRef.setInput('sectionId', id);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('should create', async () => {
    await render('application');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenSectionHasSettings_rendersARowAndControlPerSetting', async () => {
    // Every setting in this section is visible under the registry's defaults, so the count matches
    // it outright; a conditional setting's own behaviour is covered below.
    const expected: number = findSection('application')?.settings.length ?? 0;
    const element: HTMLElement = await render('application');
    expect(element.querySelectorAll('app-setting-row').length).toBe(expected);
    expect(element.querySelectorAll('app-setting-control').length).toBe(expected);
  });

  it('render_whenASettingsConditionFails_leavesItOut', async () => {
    // The menu appearance qualifies the menu button; with the full menu shown there is no button for
    // it to qualify, so the row goes rather than sitting there doing nothing.
    TestBed.inject(Settings).set('application.menuMode', 'full');

    const element: HTMLElement = await render('application');

    expect(element.textContent).toContain('Application menu');
    expect(element.textContent).not.toContain('Application menu appearance');
  });

  it('render_whenAForeignOwnedConditionFails_leavesTheDependentSettingOut', async () => {
    // The workspace texture is painted only at the full graphics-acceleration level, so below it the
    // control goes rather than sitting there having no effect. The condition names a Display-owned
    // key, which resolves through the binding layer rather than the settings store.
    TestBed.inject(Display).setGraphicsAcceleration('limited');

    const element: HTMLElement = await render('appearance');

    expect(element.textContent).toContain('Graphics Acceleration');
    expect(element.textContent).not.toContain('Workspace Texture');
  });

  it('render_whenAForeignOwnedConditionHolds_showsTheDependentSetting', async () => {
    TestBed.inject(Display).setGraphicsAcceleration('full');

    const element: HTMLElement = await render('appearance');

    expect(element.textContent).toContain('Workspace Texture');
  });

  it('render_whenAnAutomaticLevelResolvesToTheConditionsValue_showsTheDependentSetting', async () => {
    // The condition tests the resolved level, not the word `auto`: on a system with no reduced-effects
    // recommendation the automatic mode is the full level, so the texture applies and must be offered.
    TestBed.inject(Display).setGraphicsAcceleration('auto');

    const element: HTMLElement = await render('appearance');

    expect(element.textContent).toContain('Workspace Texture');
  });

  it('render_whenASettingsConditionHolds_showsIt', async () => {
    TestBed.inject(Settings).set('application.menuMode', 'icon');

    const element: HTMLElement = await render('application');

    expect(element.textContent).toContain('Application menu appearance');
  });

  it('render_whenSectionHasSettings_labelsEachRowFromTheRegistry', async () => {
    const element: HTMLElement = await render('application');
    expect(element.textContent).toContain('Undo history');
    expect(element.textContent).toContain('Print margins');
  });

  it('render_whenMarkdownSection_rendersEverySetting', async () => {
    const element: HTMLElement = await render('markdown');
    expect(element.querySelectorAll('app-setting-row').length).toBe(7);
  });

  it('render_whenSectionUnknown_rendersNothing', async () => {
    const element: HTMLElement = await render('does-not-exist');
    expect(element.querySelectorAll('app-setting-row').length).toBe(0);
  });

  it('render_whenSectionHasCustomSettings_skipsThem', async () => {
    // The Text Editor section has 15 global scalar settings plus a custom "profiles" entry, which is
    // rendered by a bespoke host rather than this component.
    const element: HTMLElement = await render('text-editor');
    expect(element.querySelectorAll('app-setting-row').length).toBe(15);
  });

  it('render_whenForeignOwnedSection_rendersItsRows', async () => {
    // Security is owned by its own service rather than the Settings store, so this covers the
    // owner-adapter path the language-server section used to before it became a per-language page.
    const element: HTMLElement = await render('security');
    expect(element.querySelectorAll('app-setting-row').length).toBe(1);
  });

  it('render_whenSectionHasFooter_rendersTheHint', async () => {
    const element: HTMLElement = await render('security');
    expect(element.querySelectorAll('app-setting-row').length).toBe(1);
    expect(element.querySelector('.settings-section__hint')?.textContent).toContain(
      'content-security policy',
    );
  });

  it('render_whenAppearanceSection_rendersThemeOwnedRowsAndAccentPicker', async () => {
    // Graphics acceleration, theme, accent, ribbon alignment, workspace texture.
    const element: HTMLElement = await render('appearance');
    expect(element.querySelectorAll('app-setting-row').length).toBe(5);
    // The accent picker renders a dropdown with an option per preset plus the trailing Custom entry.
    expect(element.querySelector('app-accent-picker')).toBeTruthy();
    expect(element.querySelectorAll('app-accent-picker option').length).toBe(
      ACCENT_PRESETS.length + 1,
    );
  });

  it('render_whenAppearanceSection_keepsTheChosenSettingOrder', async () => {
    // The section renders in registry order, and this order was chosen deliberately: the setting that
    // governs what the rest of them can do comes first. Nothing else pins it, so an edit that
    // reordered the registry entries would otherwise shuffle the page silently.
    const element: HTMLElement = await render('appearance');
    const titles: string[] = Array.from(element.querySelectorAll('app-setting-row')).map(
      (row: Element): string => row.querySelector('.setting-row__label')?.textContent?.trim() ?? '',
    );

    expect(titles).toEqual([
      'Graphics Acceleration',
      'Theme',
      'Accent',
      'Ribbon Alignment',
      'Workspace Texture',
    ]);
  });

  it('render_whenSettingHasDynamicDescription_usesTheResolvedText', async () => {
    const element: HTMLElement = await render('appearance');
    expect(element.textContent).toContain('Automatic resolves to');
  });
});
