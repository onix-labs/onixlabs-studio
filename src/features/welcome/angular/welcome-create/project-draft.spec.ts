import { TestBed } from '@angular/core/testing';
import type { Skill } from '@shared/api/skill-channels';
import type { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { WorkspaceAgentStart, Workspaces } from '@shared/angular/services/workspaces/workspaces';
import { ProjectDraft } from './project-draft';
import { FakeProjectMachine } from './project-draft.testing';
import { PROJECT_TEMPLATES, ProjectTemplate } from './project-templates';

describe('ProjectDraft', () => {
  let machine: FakeProjectMachine;
  let draft: ProjectDraft;

  beforeEach(async () => {
    machine = new FakeProjectMachine();
    TestBed.configureTestingModule({ providers: machine.providers() });
    draft = TestBed.inject(ProjectDraft);
    draft.initialise();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve);
    });
  });

  /**
   * Finds a template by its skill.
   * @param skill The skill.
   * @returns Returns the template.
   */
  function template(skill: string): ProjectTemplate {
    return PROJECT_TEMPLATES.find(
      (candidate: ProjectTemplate): boolean => candidate.skill === skill,
    )!;
  }

  it('initialise_readsWhereProjectsGo_theAccounts_andWhetherARepositoryCanBeMade', () => {
    expect(draft.location()).toBe('/Users/me/Development');
    expect(draft.accounts().map((account) => account.id)).toEqual(['github.com/matthew']);
    expect(draft.canInit()).toBe(true);
  });

  it('aTemplate_andTheUsersOwnWords_replaceEachOther', () => {
    draft.chooseTemplate(template('new-game'));
    expect(draft.template()?.skill).toBe('new-game');

    draft.describe('A photo tidier');
    expect(draft.template()).toBeNull();

    draft.chooseTemplate(template('new-web-app'));
    expect(draft.idea()).toBe('');

    draft.chooseTemplate(template('new-web-app'));
    expect(draft.template()).toBeNull();
  });

  it('touched_saysWhetherAStepHasAnythingInIt', () => {
    expect(draft.touched('start')).toBe(false);
    expect(draft.touched('details')).toBe(false);

    draft.describe('A photo tidier');
    draft.summary.set('For me.');
    draft.toggleTechnology('rust');
    draft.setOption('licence', 'mit');

    expect(draft.touched('start')).toBe(true);
    expect(draft.touched('details')).toBe(true);
    expect(draft.touched('technology')).toBe(true);
    expect(draft.touched('options')).toBe(true);

    draft.setOption('licence', '');
    expect(draft.touched('options')).toBe(false);

    expect(draft.touched('skills')).toBe(false);
    draft.toggleSkill('house-style');
    expect(draft.touched('skills')).toBe(true);
  });

  it('move_walksTheSteps_rememberingThoseVisited', () => {
    draft.move(-1);
    expect(draft.step()).toBe('start');

    draft.move(1);
    draft.move(1);
    expect(draft.step()).toBe('technology');
    expect([...draft.visited()]).toEqual(['start', 'details', 'technology']);
  });

  it('addTechnology_addsItUnderOther_orSelectsTheOneListedUnderThatName', () => {
    draft.addTechnology('postgres');
    expect(draft.technologies().has('postgresql')).toBe(true);
    expect(draft.ownTechnologies()).toEqual([]);

    draft.addTechnology('  Marten ');
    expect(draft.ownTechnologies()).toEqual([
      expect.objectContaining({ id: 'own:marten', name: 'Marten', category: 'other' }),
    ]);
    expect(draft.technologies().has('own:marten')).toBe(true);
  });

  it('toWorkspace_needsANameAndAPlace', () => {
    expect(draft.toWorkspace()).toBe(false);
    draft.name.set('todo-app');
    expect(draft.toWorkspace()).toBe(true);
    draft.location.set(null);
    expect(draft.toWorkspace()).toBe(false);
  });

  it('detailsProblem_saysWhatAWorkspaceStillNeeds', () => {
    draft.name.set('todo app');
    expect(draft.detailsProblem()).toContain('letters, digits');

    draft.name.set('todo-app');
    expect(draft.detailsProblem()).toBeNull();

    draft.setRepository('private');
    expect(draft.detailsProblem()).toContain('laid out');

    draft.layout.set('flat');
    expect(draft.detailsProblem()).toBeNull();
    expect(draft.account()).toBe('github.com/matthew');
  });

  it('send_withoutAName_opensAnAgentTab_withTheMessage_andClearsTheDraft', async () => {
    draft.chooseTemplate(template('new-cli-tool'));
    draft.summary.set('Tidies photos.');

    expect(await draft.send()).toBe(true);

    const tabs: readonly Tab[] = TestBed.inject(Tabs).tabs();
    expect(tabs.map((tab: Tab): string => tab.type)).toEqual(['agent']);
    const start: WorkspaceAgentStart | undefined = TestBed.inject(Workspaces).takeAgentStart(
      tabs[0].id,
    );
    expect(start?.prompt).toContain('I want to build a command-line tool.');
    expect(start?.prompt).toContain('Tidies photos.');
    expect(start?.brief).toContain('nowhere to create files');
    expect(machine.created).toEqual([]);
    expect(draft.template()).toBeNull();
    expect(draft.step()).toBe('start');
  });

  it('send_withANameAndAPlace_makesTheProject_andOpensItWithTheMessage', async () => {
    draft.chooseTemplate(template('new-game'));
    draft.name.set('todo-app');
    draft.setRepository('local');
    draft.layout.set('worktree');

    expect(await draft.send()).toBe(true);

    expect(machine.created).toEqual([
      { name: 'todo-app', repository: { kind: 'local', layout: 'worktree' } },
    ]);
    expect(machine.opened[0].path).toBe('/Users/me/Development/todo-app');
    expect(machine.opened[0].start?.prompt).toContain(
      'I\'ve created a project for it called "todo-app", at /Users/me/Development/todo-app, with a local repository.',
    );
    expect(machine.opened[0].start?.brief).toContain('in its new workspace');
  });

  it('send_withUnfinishedDetails_saysWhat_andShowsTheDetails', async () => {
    draft.name.set('todo-app');
    draft.setRepository('local');
    draft.goTo('summary');

    expect(await draft.send()).toBe(false);

    expect(draft.error()).toContain('laid out');
    expect(draft.step()).toBe('details');
    expect(machine.created).toEqual([]);
  });

  it('send_whenTheProjectCannotBeMade_keepsTheDraft', async () => {
    machine.outcome = { ok: false, error: 'It already exists.' };
    draft.name.set('todo-app');

    expect(await draft.send()).toBe(false);

    expect(draft.error()).toBe('It already exists.');
    expect(draft.name()).toBe('todo-app');
  });

  it('send_attachesTextDocumentsAsContext_andImagesAsImages', async () => {
    machine.documents = {
      documents: [
        { kind: 'text', name: 'notes.md', path: '/d/notes.md', content: '# Notes' },
        {
          kind: 'image',
          name: 'sketch.png',
          path: '/d/sketch.png',
          mediaType: 'image/png',
          data: 'AA==',
        },
      ],
      skipped: [{ name: 'spec.pdf', reason: 'Only text documents and images can be attached.' }],
    };
    await draft.addDocuments();
    expect(draft.skippedDocuments()).toHaveLength(1);
    draft.name.set('todo-app');

    await draft.send();

    const start: WorkspaceAgentStart | undefined = machine.opened[0].start;
    expect(start?.context).toEqual([
      { path: '/d/notes.md', kind: 'selection', content: '# Notes' },
    ]);
    expect(start?.images).toEqual([{ mediaType: 'image/png', data: 'AA==', name: 'sketch.png' }]);
    expect(start?.prompt).toContain('- notes.md\n- sketch.png');
  });

  it('send_briefsTheAgent_withTheTemplatesSkill_andThoseChosen', async () => {
    machine.skills = [
      { name: 'new-game', problem: null, body: 'Ask about the engine.' } as Skill,
      { name: 'house-style', problem: null, body: 'Use British English.' } as Skill,
      { name: 'unused', problem: null, body: 'Never.' } as Skill,
    ];
    draft.chooseTemplate(template('new-game'));
    draft.toggleSkill('house-style');

    await draft.send();

    const tab: Tab = TestBed.inject(Tabs).tabs()[0];
    const brief: string = TestBed.inject(Workspaces).takeAgentStart(tab.id)!.brief;
    expect(brief).toContain('Ask about the engine.');
    expect(brief).toContain('Use British English.');
    expect(brief).not.toContain('Never.');
  });

  it('availableSkills_offersEveryOneThatLoads_switchedOffOrNot', () => {
    machine.skills = [
      { name: 'on', enabled: true, problem: null } as Skill,
      { name: 'off', enabled: false, problem: null } as Skill,
      { name: 'broken', enabled: true, problem: 'Bad frontmatter.' } as Skill,
    ];

    expect(draft.availableSkills().map((skill: Skill): string => skill.name)).toEqual([
      'on',
      'off',
    ]);
  });

  it('importSkill_choosesWhatItImports_orSaysWhyItCouldNot', async () => {
    machine.importResult = { skill: { name: 'house-style' } as Skill, error: null };
    await draft.importSkill();
    expect([...draft.skills()]).toEqual(['house-style']);

    machine.importResult = { skill: null, error: 'Not a skill.' };
    await draft.importSkill();
    expect(draft.skillImportError()).toBe('Not a skill.');

    machine.importResult = null;
    await draft.importSkill();
    expect(draft.skillImportError()).toBeNull();
    expect([...draft.skills()]).toEqual(['house-style']);
  });

  it('message_previewsWhereTheProjectWillBeMade', () => {
    draft.name.set('todo-app');
    expect(draft.message()).toContain('called "todo-app", at /Users/me/Development/todo-app.');

    draft.location.set(null);
    expect(draft.message()).toContain('I\'d like to call it "todo-app".');
  });
});
