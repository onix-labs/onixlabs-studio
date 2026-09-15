import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AGENT_SURFACE_LABELS, AGENT_SURFACES } from '@shared/api/ai-types';
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

  it('render_whenProfileExists_showsItsSurfacesInTheScopePicker', async () => {
    service.update(service.create('One').id, { scope: { surfaces: ['terminal'], languages: [] } });
    fixture.detectChanges();
    await fixture.whenStable();
    element().querySelector<HTMLButtonElement>('.accordion__header')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    // The surfaces picker is the first multi-select in the profile; its face names what is ticked.
    const faces: NodeListOf<HTMLButtonElement> = element().querySelectorAll<HTMLButtonElement>(
      'app-multi-select .multi-select',
    );
    expect(faces).toHaveLength(2);
    expect(faces[0].textContent?.trim()).toBe(AGENT_SURFACE_LABELS.terminal);

    faces[0].click();
    TestBed.tick();
    expect(document.querySelectorAll('.multi-select__option')).toHaveLength(AGENT_SURFACES.length);
  });

  it('delete_removesTheProfile', async () => {
    service.create('One');
    fixture.detectChanges();
    await fixture.whenStable();
    element().querySelector<HTMLButtonElement>('.accordion__header')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    element().querySelector<HTMLButtonElement>('.profiles__footer button')?.click();
    fixture.detectChanges();

    expect(service.profiles()).toHaveLength(0);
  });
});
