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

  it('render_whenAForeignOwnedConditionFails_leavesTheDependentSettingsOut', async () => {
    // Modern UI Features and Workspace Texture are forced off without hardware acceleration, so the
    // controls go rather than sitting there having no effect. The condition names a Display-owned
    // key, which resolves through the binding layer rather than the settings store.
    TestBed.inject(Display).setHardwareAcceleration(false);

    const element: HTMLElement = await render('appearance');

    expect(element.textContent).toContain('Hardware Acceleration');
    expect(element.textContent).not.toContain('Modern UI Features');
    expect(element.textContent).not.toContain('Workspace Texture');
  });

  it('render_whenAForeignOwnedConditionHolds_showsTheDependentSettings', async () => {
    TestBed.inject(Display).setHardwareAcceleration(true);

    const element: HTMLElement = await render('appearance');

    expect(element.textContent).toContain('Modern UI Features');
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
    // Accent, theme, ribbon alignment, modern UI features, workspace texture, hardware acceleration.
    const element: HTMLElement = await render('appearance');
    expect(element.querySelectorAll('app-setting-row').length).toBe(6);
    // The accent picker renders a dropdown with an option per preset plus the trailing Custom entry.
    expect(element.querySelector('app-accent-picker')).toBeTruthy();
    expect(element.querySelectorAll('app-accent-picker option').length).toBe(
      ACCENT_PRESETS.length + 1,
    );
    expect(element.querySelector('app-toggle')).toBeTruthy();
  });

  it('render_whenSettingHasDynamicDescription_usesTheResolvedText', async () => {
    const element: HTMLElement = await render('appearance');
    expect(element.textContent).toContain('Recommended for this system');
  });
});
