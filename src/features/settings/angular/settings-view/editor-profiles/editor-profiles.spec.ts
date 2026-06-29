import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditorProfile, Settings } from '@shared/angular/services/settings/settings';
import { EditorProfiles } from './editor-profiles';

describe('EditorProfiles', () => {
  let component: EditorProfiles;
  let fixture: ComponentFixture<EditorProfiles>;
  let settings: Settings;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [EditorProfiles],
    }).compileComponents();

    fixture = TestBed.createComponent(EditorProfiles);
    component = fixture.componentInstance;
    settings = TestBed.inject(Settings);
    await fixture.whenStable();
  });

  /**
   * Adds a profile and expands its accordion, returning the rendered root.
   * @returns Returns the component's root element.
   */
  async function addAndExpandProfile(): Promise<HTMLElement> {
    settings.createProfile('TS', ['typescript']);
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.accordion__header')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    return element;
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenProfileAdded_showsAnAccordion', async () => {
    settings.createProfile('TS', ['typescript']);
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('app-accordion').length).toBe(1);
  });

  it('render_whenRegistryDrivesRows_rendersAnOverridePerOverridableSetting', async () => {
    const element: HTMLElement = await addAndExpandProfile();
    expect(element.querySelectorAll('.override').length).toBe(7);
  });

  it('render_whenProfileDoesNotOverride_leavesOverrideCheckboxesUnchecked', async () => {
    const element: HTMLElement = await addAndExpandProfile();

    const checks: NodeListOf<HTMLInputElement> =
      element.querySelectorAll<HTMLInputElement>('.override__check input');
    expect(checks.length).toBe(7);
    expect(Array.from(checks).every((check: HTMLInputElement): boolean => !check.checked)).toBe(
      true,
    );
  });

  it('onOverrideToggle_whenEnabled_recordsTheOverrideOnTheProfile', async () => {
    const profile: EditorProfile = settings.createProfile('TS', ['typescript']);
    const element: HTMLElement = await addAndExpandProfile();

    const firstCheck: HTMLInputElement =
      element.querySelector<HTMLInputElement>('.override__check input')!;
    firstCheck.checked = true;
    firstCheck.dispatchEvent(new Event('change'));

    const updated: EditorProfile | undefined = settings
      .profiles()
      .find((candidate: EditorProfile): boolean => candidate.id === profile.id);
    expect(Object.keys(updated?.settings ?? {}).length).toBe(1);
  });
});
