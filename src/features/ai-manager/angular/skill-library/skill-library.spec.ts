import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Skill, SkillDraft, SkillSaveResult } from '@shared/api/skill-channels';
import { Skills } from '@shared/angular/services/skills/skills';
import { AiLibraryCommands } from '../ai-library-commands/ai-library-commands';
import { SkillLibrarySection } from './skill-library';

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

describe('SkillLibrarySection', () => {
  let fixture: ComponentFixture<SkillLibrarySection>;
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
      imports: [SkillLibrarySection],
      providers: [{ provide: Skills, useValue: skillsStub }],
    }).compileComponents();
    fixture = TestBed.createComponent(SkillLibrarySection);
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

  /**
   * Gets the side panel's entries.
   * @returns Returns the entry buttons.
   */
  function entries(): HTMLButtonElement[] {
    return [...element().querySelectorAll<HTMLButtonElement>('.category-list__item')];
  }

  /**
   * Starts a new skill from the ribbon and lets its editor render.
   * @returns Resolves once the editor is rendered.
   */
  async function addFromTheRibbon(): Promise<void> {
    fixture.detectChanges();
    TestBed.inject(AiLibraryCommands).add('skills');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Selects the first skill in the side panel and lets its editor render.
   * @returns Resolves once the editor is rendered.
   */
  async function selectFirst(): Promise<void> {
    entries()[0]?.click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('render_whenEmpty_saysSo_andOffersNewAndImport', () => {
    fixture.detectChanges();

    expect(element().querySelector('.library__empty-text')?.textContent).toContain('No skills yet');
    expect(element().querySelector('.library__editor')).toBeNull();
    expect(button('New Skill')).toBeTruthy();
    expect(button('Import…')).toBeTruthy();
  });

  it('sidePanel_listsEachSkill_flagsOneThatCannotBeOffered_andShowsTheSelectedOnesFiles', async () => {
    stored.set([skill('a'), { ...skill('b'), problem: 'No description.' }]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      entries().map((entry) => entry.querySelector('.category-list__label')?.textContent?.trim()),
    ).toEqual(['a', 'b']);
    expect(entries()[1].querySelector('.category-list__badge')).not.toBeNull();
    await selectFirst();
    expect(element().querySelector('.library__files li')?.textContent?.trim()).toBe('ref.md');
  });

  /**
   * Edits the selected skill the way its fields do, then waits out the save's pause.
   * @param patch The fields to change.
   * @returns Resolves once the save has had its chance to run.
   */
  async function editAndPause(patch: Partial<SkillDraft>): Promise<void> {
    const view: {
      selected(): unknown;
      edit(row: unknown, patch: Partial<SkillDraft>): void;
    } = fixture.componentInstance as unknown as {
      selected(): unknown;
      edit(row: unknown, patch: Partial<SkillDraft>): void;
    };
    view.edit(view.selected(), patch);
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 700);
    });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('edit_savesItselfAMomentLater_withoutASaveButton', async () => {
    // #954. A skill saves as it is edited, as a profile does.
    await addFromTheRibbon();
    expect(button('Save')).toBeUndefined();

    await editAndPause({ name: 'my-skill', description: 'House style.' });

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'my-skill', description: 'House style.' });
  });

  it('edit_ofANewSkill_waitsForANameAndADescription', async () => {
    await addFromTheRibbon();

    await editAndPause({ name: 'my-skill' });

    expect(saved).toHaveLength(0);
    expect(element().querySelector('.library__notice')?.textContent).toContain(
      'a name and a description',
    );
  });

  it('save_whenRefused_showsTheReasonAndKeepsTheDraft', async () => {
    saveError = 'That name is not a valid folder name.';
    await addFromTheRibbon();

    await editAndPause({ name: 'Bad Name', description: 'd' });

    expect(element().querySelector('.library__error')?.textContent).toContain('not a valid');
    expect(entries()).toHaveLength(1);
  });

  it('delete_fromTheBinOnItsEntry_asksFirst_andRemovesTheFolderOnConfirm', async () => {
    stored.set([skill('a')]);
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog: { deleteTarget(): unknown; confirmDelete(): Promise<void> } =
      fixture.componentInstance as unknown as {
        deleteTarget(): unknown;
        confirmDelete(): Promise<void>;
      };

    element().querySelector<HTMLButtonElement>('.category-list__action')?.click();
    expect(dialog.deleteTarget()).not.toBeNull();
    expect(deleted).toEqual([]);

    await dialog.confirmDelete();

    expect(deleted).toEqual(['a']);
    expect(dialog.deleteTarget()).toBeNull();
  });
});
