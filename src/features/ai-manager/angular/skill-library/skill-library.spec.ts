import { By } from '@angular/platform-browser';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Skill, SkillDraft, SkillSaveResult } from '@shared/api/skill-channels';
import { Skills } from '@shared/angular/services/skills/skills';
import { AiLibraryCommands } from '../ai-library-commands/ai-library-commands';
import { SKILL_TAG_OPTIONS } from '../skill-tags/skill-tags';
import { SkillLibrarySection } from './skill-library';
import type { SkillImportDraft } from '@shared/api/skill-import-channels';
import { Agent } from '@shared/angular/services/agent/agent';
import { SkillAssist, SkillAssistResult } from '../skill-assist/skill-assist';
import {
  openSidebarSection,
  SkillsWithSidebar,
} from '../ai-manager-sidebar/ai-manager-sidebar.testing';
import { AiManagerNavigation } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';

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
    technologies: [],
    enabled: true,
    body: 'b',
    directory: `/lib/${name}`,
    files: ['ref.md'],
    problem: null,
  };
}

describe('SkillLibrarySection', () => {
  let fixture: ComponentFixture<SkillsWithSidebar>;
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
    TestBed.inject(AiManagerNavigation).show('skills');
    fixture = TestBed.createComponent(SkillsWithSidebar);
    await fixture.whenStable();
    await openSidebarSection(fixture, 'Skills');
  });

  /**
   * Gets the section under test, inside its host.
   * @returns Returns the section, typed loosely so a spec can reach its protected members.
   */
  function section(): never {
    return fixture.debugElement
      .query(By.directive(SkillLibrarySection))
      .injector.get(SkillLibrarySection) as never;
  }

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
    expect(button('Import')).toBeTruthy();
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
    } = section();
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

  it('tags_areOneList_languagesNarrowTheEditor_theRestAreTechnologies', async () => {
    // #962. Languages and technologies are picked in one list; an editor language goes into the
    // scope, anything else into the technologies, and a hand-written id the list lacks is kept.
    stored.set([{ ...skill('a'), technologies: ['hand-written'] }]);
    fixture.detectChanges();
    await fixture.whenStable();
    await selectFirst();
    const view: {
      selected(): unknown;
      setTags(row: unknown, ids: readonly string[]): void;
    } = section();

    view.setTags(view.selected(), ['typescript', 'angular']);
    await editAndPause({});

    expect(saved.at(-1)?.scope.languages).toEqual(['typescript']);
    expect(saved.at(-1)?.technologies).toEqual(['angular', 'hand-written']);
  });

  it('tagOptions_listLanguagesFirst_thenEachCategory_withNoIdTwice', () => {
    const values: string[] = SKILL_TAG_OPTIONS.map((option) => option.value);

    expect(SKILL_TAG_OPTIONS[0].group).toBe('Languages');
    expect(new Set(values).size).toBe(values.length);
    expect(SKILL_TAG_OPTIONS.find((option) => option.value === 'angular')?.group).toBe('Frontend');
    expect(SKILL_TAG_OPTIONS.some((option) => option.group === 'Other')).toBe(false);
  });

  it('delete_fromTheBinOnItsEntry_asksFirst_andRemovesTheFolderOnConfirm', async () => {
    stored.set([skill('a')]);
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog: { deleteTarget(): unknown; confirmDelete(): Promise<void> } = section();

    element().querySelector<HTMLButtonElement>('.category-list__action')?.click();
    expect(dialog.deleteTarget()).not.toBeNull();
    expect(deleted).toEqual([]);

    await dialog.confirmDelete();

    expect(deleted).toEqual(['a']);
    expect(dialog.deleteTarget()).toBeNull();
  });
});

describe('SkillLibrarySection › Improve with AI (#1263)', () => {
  let fixture: ComponentFixture<SkillsWithSidebar>;
  let saved: SkillDraft[];
  let answer: SkillAssistResult;
  let seen: SkillImportDraft[];

  beforeEach(async () => {
    saved = [];
    seen = [];
    answer = {
      kind: 'draft',
      draft: {
        name: 'a',
        description: 'Sharper.',
        scope: { surfaces: [], languages: [] },
        technologies: [],
        enabled: true,
        body: 'Better body.',
      },
    };
    const skillsStub: Partial<Skills> = {
      skills: signal<readonly Skill[]>([skill('a')]),
      loading: signal<boolean>(false),
      reload: (): Promise<void> => Promise.resolve(),
      save: (draft: SkillDraft): Promise<SkillSaveResult> => {
        saved.push(draft);
        return Promise.resolve({ skill: skill(draft.name), error: null });
      },
    };
    const assistStub: Partial<SkillAssist> = {
      isAvailable: true,
      improve: (draft: SkillImportDraft): Promise<SkillAssistResult> => {
        seen.push(draft);
        return Promise.resolve(answer);
      },
    };
    const agentStub: Partial<Agent> = {
      provider: signal('claude').asReadonly(),
      model: signal('').asReadonly(),
      providerLabel: signal<string | null>('Claude').asReadonly(),
    };
    await TestBed.configureTestingModule({
      imports: [SkillLibrarySection],
      providers: [
        { provide: Skills, useValue: skillsStub },
        { provide: SkillAssist, useValue: assistStub },
        { provide: Agent, useValue: agentStub },
      ],
    }).compileComponents();
    TestBed.inject(AiManagerNavigation).show('skills');
    fixture = TestBed.createComponent(SkillsWithSidebar);
    await fixture.whenStable();
    await openSidebarSection(fixture, 'Skills');
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.category-list__item')
      ?.click();
    fixture.detectChanges();
    await fixture.whenStable();
  });

  /**
   * Gets the section under test.
   * @returns Returns it, typed loosely to reach its protected members.
   */
  function section(): {
    selected(): unknown;
    improve(row: unknown): Promise<void>;
    improvement(): { draft: SkillImportDraft } | null;
    reviseImprovement(draft: SkillImportDraft): void;
    improvementProblem(): string | null;
    acceptImprovement(): void;
    discardImprovement(): void;
    notice(): string | null;
  } {
    return fixture.debugElement
      .query(By.directive(SkillLibrarySection))
      .injector.get(SkillLibrarySection) as never;
  }

  it('improve_sendsTheSkillAsItStands_andShowsTheAiVersionForReview', async () => {
    await section().improve(section().selected());

    expect(seen[0]).toMatchObject({ name: 'a', description: 'd', body: 'b' });
    expect(section().improvement()?.draft.description).toBe('Sharper.');
  });

  it('accept_appliesTheAiVersion_whichThenSavesItself', async () => {
    await section().improve(section().selected());
    section().acceptImprovement();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 700);
    });

    expect(section().improvement()).toBeNull();
    expect(saved[0]).toMatchObject({ name: 'a', description: 'Sharper.', body: 'Better body.' });
    expect(section().notice()).toContain('Applied');
  });

  it('discard_leavesTheSkillAsItWas', async () => {
    await section().improve(section().selected());
    section().discardImprovement();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 700);
    });

    expect(section().improvement()).toBeNull();
    expect(saved).toEqual([]);
  });

  it('accept_whenTheEditedVersionIsInvalid_isRefused', async () => {
    await section().improve(section().selected());
    section().reviseImprovement({ ...section().improvement()!.draft, name: 'Not Valid' });

    expect(section().improvementProblem()).toContain('lower-case');
  });

  it('improve_whenTheAiFails_saysSo_andChangesNothing', async () => {
    answer = { kind: 'error', reason: 'The AI took too long to answer.' };
    await section().improve(section().selected());

    expect(section().improvement()).toBeNull();
    expect(section().notice()).toContain('The AI took too long to answer.');
  });
});
