import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AGENT_SURFACES } from '@shared/api/ai-types';
import { PromptProfiles } from '@shared/angular/services/prompt-profiles/prompt-profiles';
import { PromptProfilesSettings } from './prompt-profiles';

describe('PromptProfilesSettings', () => {
  let fixture: ComponentFixture<PromptProfilesSettings>;
  let service: PromptProfiles;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [PromptProfilesSettings] }).compileComponents();
    fixture = TestBed.createComponent(PromptProfilesSettings);
    service = TestBed.inject(PromptProfiles);
    await fixture.whenStable();
  });

  /**
   * Gets the rendered root.
   * @returns Returns the element.
   */
  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('render_whenEmpty_showsTheEmptyState', () => {
    fixture.detectChanges();

    expect(element().querySelector('.profiles__empty')).not.toBeNull();
    expect(element().querySelectorAll('app-accordion')).toHaveLength(0);
  });

  it('add_createsAProfileAndOpensIt', async () => {
    fixture.detectChanges();

    element().querySelector<HTMLButtonElement>('.profiles__header button')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(service.profiles()).toHaveLength(1);
    expect(element().querySelectorAll('app-accordion')).toHaveLength(1);
    expect(element().querySelector('app-textarea')).not.toBeNull();
  });

  it('render_whenProfileExists_showsItsSurfacesAsCheckboxes', async () => {
    service.update(service.create('One').id, { scope: { surfaces: ['terminal'], languages: [] } });
    fixture.detectChanges();
    await fixture.whenStable();
    element().querySelector<HTMLButtonElement>('.accordion__header')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const checks: NodeListOf<HTMLInputElement> =
      element().querySelectorAll<HTMLInputElement>('.scope__surface input');
    expect(checks).toHaveLength(AGENT_SURFACES.length);
    expect(
      Array.from(checks).filter((check: HTMLInputElement): boolean => check.checked),
    ).toHaveLength(1);
  });

  it('delete_removesTheProfile', async () => {
    service.create('One');
    fixture.detectChanges();
    await fixture.whenStable();
    element().querySelector<HTMLButtonElement>('.accordion__header')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    element().querySelector<HTMLButtonElement>('.profiles__delete button')?.click();
    fixture.detectChanges();

    expect(service.profiles()).toHaveLength(0);
  });
});
