import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Skill, SkillDraft, SkillSaveResult } from '@shared/api/skill-channels';
import { Skills } from '@shared/angular/services/skills/skills';
import { SkillLibrarySettings } from './skill-library';

/**
 * Builds a stored skill.
 * @param name The name.
 * @returns Returns the skill.
 */
function skill(name: string): Skill {
  return {
    name,
    description: 'd',
    scope: { surfaces: [], languages: [] },
    enabled: true,
    body: 'b',
    directory: `/lib/${name}`,
    files: ['ref.md'],
    problem: null,
  };
}

describe('SkillLibrarySettings', () => {
  let fixture: ComponentFixture<SkillLibrarySettings>;
  let stored: WritableSignal<readonly Skill[]>;
  let saved: SkillDraft[];
  let deleted: string[];
  let saveError: string | null;

  beforeEach(async () => {
    stored = signal<readonly Skill[]>([]);
    saved = [];
    deleted = [];
    saveError = null;
    const skillsStub: Partial<Skills> = {
      skills: stored,
      loading: signal<boolean>(false),
      reload: (): Promise<void> => Promise.resolve(),
      save: (draft: SkillDraft): Promise<SkillSaveResult> => {
        saved.push(draft);
        return Promise.resolve(
          saveError === null
            ? { skill: skill(draft.name), error: null }
            : { skill: null, error: saveError },
        );
      },
      delete: (name: string): Promise<void> => {
        deleted.push(name);
        return Promise.resolve();
      },
      reveal: (): Promise<void> => Promise.resolve(),
      openLibrary: (): Promise<void> => Promise.resolve(),
      import: (): Promise<SkillSaveResult | null> => Promise.resolve(null),
    };
    await TestBed.configureTestingModule({
      imports: [SkillLibrarySettings],
      providers: [{ provide: Skills, useValue: skillsStub }],
    }).compileComponents();
    fixture = TestBed.createComponent(SkillLibrarySettings);
    await fixture.whenStable();
  });

  /**
   * Gets the rendered root.
   * @returns Returns the element.
   */
  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Finds the button whose label matches.
   * @param label The label text.
   * @returns Returns the button.
   */
  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(element().querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    );
  }

  it('render_whenEmpty_showsTheEmptyState', () => {
    fixture.detectChanges();

    expect(element().querySelector('.skills__empty')).not.toBeNull();
  });

  it('render_whenStored_showsAnAccordionPerSkillWithItsBundledFiles', async () => {
    stored.set([skill('a'), skill('b')]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(element().querySelectorAll('app-accordion')).toHaveLength(2);
    element().querySelector<HTMLButtonElement>('.accordion__header')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(element().querySelector('.skills__file')?.textContent?.trim()).toBe('ref.md');
  });

  it('add_thenSave_sendsTheDraft', async () => {
    fixture.detectChanges();
    button('Add skill')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const name: HTMLInputElement =
      element().querySelector<HTMLInputElement>('app-text-field input')!;
    name.value = 'my-skill';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Save')?.click();
    await fixture.whenStable();

    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('my-skill');
  });

  it('save_whenRefused_showsTheReasonAndKeepsTheDraft', async () => {
    saveError = 'The frontmatter has no description, so a model cannot tell when to use it.';
    fixture.detectChanges();
    button('Add skill')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    button('Save')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element().querySelector('.skills__error')?.textContent).toContain('no description');
    expect(element().querySelectorAll('app-accordion')).toHaveLength(1);
  });

  it('delete_removesAStoredSkill', async () => {
    stored.set([skill('a')]);
    fixture.detectChanges();
    await fixture.whenStable();
    element().querySelector<HTMLButtonElement>('.accordion__header')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    button('Delete skill')?.click();
    await fixture.whenStable();

    expect(deleted).toEqual(['a']);
  });
});
