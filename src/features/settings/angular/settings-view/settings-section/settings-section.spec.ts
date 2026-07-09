import { ComponentFixture, TestBed } from '@angular/core/testing';

import { findSection } from '@shared/angular/services/settings/settings-registry';
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
    const expected: number = findSection('application')?.settings.length ?? 0;
    const element: HTMLElement = await render('application');
    expect(element.querySelectorAll('app-setting-row').length).toBe(expected);
    expect(element.querySelectorAll('app-setting-control').length).toBe(expected);
  });

  it('render_whenSectionHasSettings_labelsEachRowFromTheRegistry', async () => {
    const element: HTMLElement = await render('application');
    expect(element.textContent).toContain('Default document type');
    expect(element.textContent).toContain('Undo history');
    expect(element.textContent).toContain('Title bar quick actions');
  });

  it('render_whenMarkdownSection_rendersEverySetting', async () => {
    const element: HTMLElement = await render('markdown');
    expect(element.querySelectorAll('app-setting-row').length).toBe(6);
  });

  it('render_whenSectionUnknown_rendersNothing', async () => {
    const element: HTMLElement = await render('does-not-exist');
    expect(element.querySelectorAll('app-setting-row').length).toBe(0);
  });

  it('render_whenSectionHasCustomSettings_skipsThem', async () => {
    // The Text Editor section has 14 global scalar settings plus a custom "profiles" entry, which is
    // rendered by a bespoke host rather than this component.
    const element: HTMLElement = await render('text-editor');
    expect(element.querySelectorAll('app-setting-row').length).toBe(14);
  });

  it('render_whenForeignOwnedSection_rendersItsRows', async () => {
    const element: HTMLElement = await render('language-servers');
    expect(element.querySelectorAll('app-setting-row').length).toBe(14);
  });

  it('render_whenSectionHasFooter_rendersTheHint', async () => {
    const element: HTMLElement = await render('security');
    expect(element.querySelectorAll('app-setting-row').length).toBe(1);
    expect(element.querySelector('.settings-section__hint')?.textContent).toContain(
      'content-security policy',
    );
  });

  it('render_whenAppearanceSection_rendersThemeOwnedRowsAndSwatches', async () => {
    // Accent, theme, ribbon alignment, modern UI features, hardware acceleration.
    const element: HTMLElement = await render('appearance');
    expect(element.querySelectorAll('app-setting-row').length).toBe(5);
    expect(element.querySelectorAll('.swatch').length).toBe(8);
    expect(element.querySelector('app-toggle')).toBeTruthy();
  });

  it('render_whenSettingHasDynamicDescription_usesTheResolvedText', async () => {
    const element: HTMLElement = await render('appearance');
    expect(element.textContent).toContain('Recommended for this system');
  });
});
