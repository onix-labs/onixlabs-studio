import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type {
  NewProjectOutcome,
  NewProjectRepository,
  PickedDocuments,
  ProjectDocument,
} from '@shared/api/new-project-channels';
import type { Skill, SkillSaveResult } from '@shared/api/skill-channels';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Log } from '@shared/angular/services/log/log';
import { NewProject } from '@shared/angular/services/new-project/new-project';
import { Skills } from '@shared/angular/services/skills/skills';
import type { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { WorkspaceAgentStart, Workspaces } from '@shared/angular/services/workspaces/workspaces';
import {
  describeRepository,
  ProjectAccount,
  ProjectDestination,
  ProjectLayout,
  ProjectRepository,
} from '@shared/angular/services/new-project/project-destination';
import { MadeProject, projectBrief, projectMessage, ProjectMessageInput } from './project-message';
import {
  PROJECT_OPTIONS,
  ProjectOption,
  ProjectOptionChoice,
  ProjectTemplate,
} from './project-templates';
import { Technology, TECHNOLOGY_CATALOGUE } from '@shared/api/technology/technology-catalogue';
import {
  TECHNOLOGY_CATEGORIES,
  TECHNOLOGY_CATEGORY_LABELS,
  TechnologyCategory,
} from '@shared/api/technology/technology-category';

/**
 * Names a step of the New Project wizard, in order.
 */
export type CreateStep = 'start' | 'details' | 'technology' | 'options' | 'skills' | 'summary';

/**
 * The wizard's steps, in order.
 */
export const CREATE_STEPS: readonly CreateStep[] = [
  'start',
  'details',
  'technology',
  'options',
  'skills',
  'summary',
];

export type {
  ProjectAccount,
  ProjectLayout,
  ProjectRepository,
} from '@shared/angular/services/new-project/project-destination';
export { describeRepository } from '@shared/angular/services/new-project/project-destination';

/**
 * Gets what a skill is tagged with (#962): its languages, which double as tags, and its technologies.
 * @param skill The skill.
 * @returns Returns the ids.
 */
function tagsOf(skill: Skill): readonly string[] {
  return [...skill.scope.languages, ...skill.technologies];
}

/**
 * Holds the New Project wizard's draft (#806): everything the user has told it, which step they are
 * on, and what the machine can do — and sends it all to an agent as one first message.
 *
 * Provided at the root rather than by the welcome screen, so a draft survives the welcome screen
 * closing and opening again: it is cleared only by sending it or by starting over. Every step is
 * optional; one with nothing in it is left out of the message.
 */
@Service()
export class ProjectDraft {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the new-project service, which makes the project and reads supporting documents.
   */
  private readonly newProject: NewProject = inject(NewProject);

  /**
   * Holds the file opener, which opens the project as a workspace.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the tab service, which opens the agent's own tab when there is no project folder yet.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the per-tab handoff, which carries the agent's start to the tab it opens in.
   */
  private readonly workspaces: Workspaces = inject(Workspaces);

  /**
   * Holds the skill library, where a template's skill and the skills offered are found.
   */
  private readonly skillLibrary: Skills = inject(Skills);

  /**
   * Holds whether the machine's state has been read once.
   */
  private initialised: boolean = false;

  /**
   * Holds where the project goes and what it starts with — shared with the card an agent tab offers a
   * workspace with (#876), so both ask the same questions the same way.
   */
  public readonly destination: ProjectDestination = new ProjectDestination();

  /**
   * Holds the step shown.
   */
  public readonly step: WritableSignal<CreateStep> = signal<CreateStep>('start');

  /**
   * Holds the steps the user has been on.
   */
  public readonly visited: WritableSignal<ReadonlySet<CreateStep>> = signal<
    ReadonlySet<CreateStep>
  >(new Set<CreateStep>(['start']));

  /**
   * Holds the template chosen, or null.
   */
  public readonly template: WritableSignal<ProjectTemplate | null> = signal<ProjectTemplate | null>(
    null,
  );

  /**
   * Holds the user's own description of what they want to build, when no template fits.
   */
  public readonly idea: WritableSignal<string> = signal<string>('');

  /**
   * Holds the user's summary of the project.
   */
  public readonly summary: WritableSignal<string> = signal<string>('');

  /**
   * Holds the project's name, which is also its folder's.
   */
  public readonly name: WritableSignal<string> = this.destination.name;

  /**
   * Holds the folder the project's folder is made in, or null until one is known.
   */
  public readonly location: WritableSignal<string | null> = this.destination.location;

  /**
   * Holds where the repository lives, or null when not chosen — which means none.
   */
  public readonly repository: WritableSignal<ProjectRepository | null> =
    this.destination.repository;

  /**
   * Holds how the repository is laid out, or null until the user picks.
   */
  public readonly layout: WritableSignal<ProjectLayout | null> = this.destination.layout;

  /**
   * Holds the account picked for a hosted repository — its id — or null.
   */
  public readonly account: WritableSignal<string | null> = this.destination.account;

  /**
   * Holds the supporting documents attached.
   */
  public readonly documents: WritableSignal<readonly ProjectDocument[]> = signal<
    readonly ProjectDocument[]
  >([]);

  /**
   * Holds the documents the user picked that could not be attached, with why.
   */
  public readonly skippedDocuments: WritableSignal<
    readonly { readonly name: string; readonly reason: string }[]
  > = signal<readonly { readonly name: string; readonly reason: string }[]>([]);

  /**
   * Holds the technologies selected, by id.
   */
  public readonly technologies: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the technologies the user added themselves.
   */
  public readonly ownTechnologies: WritableSignal<readonly Technology[]> = signal<
    readonly Technology[]
  >([]);

  /**
   * Holds the options answered: each option's id to its choice's value.
   */
  public readonly options: WritableSignal<ReadonlyMap<string, string>> = signal<
    ReadonlyMap<string, string>
  >(new Map<string, string>());

  /**
   * Holds the skills the user asked the agent to follow, by name.
   */
  public readonly skills: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the accounts hosted repositories can be made under, across the signed-in hosts.
   */
  public readonly accounts: WritableSignal<readonly ProjectAccount[]> = this.destination.accounts;

  /**
   * Holds whether a running version-control plugin can make a repository in place — as it says, not
   * the catalogue, whose entry may be newer than the copy installed.
   */
  public readonly canInit: WritableSignal<boolean> = this.destination.canInit;

  /**
   * Holds whether the draft is being sent.
   */
  public readonly sending: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds why the draft could not be sent, or null.
   */
  public readonly error: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets whether a version-control plugin is installed.
   */
  public readonly canVersion: Signal<boolean> = this.destination.canVersion;

  /**
   * Gets whether a hosting plugin is installed.
   */
  public readonly canHost: Signal<boolean> = this.destination.canHost;

  /**
   * Gets every technology on offer: the catalogue, then the user's own.
   */
  public readonly catalogue: Signal<readonly Technology[]> = computed((): readonly Technology[] => [
    ...TECHNOLOGY_CATALOGUE,
    ...this.ownTechnologies(),
  ]);

  /**
   * Gets the skills the library offers to follow: every one that loads without a problem. A skill the
   * user switched off is offered too — it is off for being offered automatically, and choosing it here
   * is the user asking for it.
   */
  public readonly availableSkills: Signal<readonly Skill[]> = computed((): readonly Skill[] =>
    this.skillLibrary.skills().filter((skill: Skill): boolean => skill.problem === null),
  );

  /**
   * Gets the skills suggested for the project (#962): every enabled one tagged with a language or a
   * technology the user picked. Suggesting is all it does; nothing is chosen until the user chooses it.
   */
  public readonly suggestedSkills: Signal<readonly Skill[]> = computed((): readonly Skill[] => {
    const picked: ReadonlySet<string> = this.technologies();
    return this.availableSkills().filter(
      (skill: Skill): boolean =>
        skill.enabled && tagsOf(skill).some((id: string): boolean => picked.has(id)),
    );
  });

  /**
   * Gets the names of the picked technologies a skill is tagged with, which is why it is suggested.
   * @param skill The skill.
   * @returns Returns the names, in catalogue order.
   */
  public matchedTechnologies(skill: Skill): readonly string[] {
    const picked: ReadonlySet<string> = this.technologies();
    return this.catalogue()
      .filter(
        (technology: Technology): boolean =>
          picked.has(technology.id) && tagsOf(skill).includes(technology.id),
      )
      .map((technology: Technology): string => technology.name);
  }

  /**
   * Holds why the last skill import failed, or null.
   */
  public readonly skillImportError: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets whether the repository picked is one a code host makes.
   */
  public readonly hosted: Signal<boolean> = this.destination.hosted;

  /**
   * Gets whether the name can be a folder's.
   */
  public readonly nameValid: Signal<boolean> = this.destination.nameValid;

  /**
   * Gets whether the draft goes to a workspace made for it: there is a name and a place. Otherwise
   * the agent opens in its own tab.
   */
  public readonly toWorkspace: Signal<boolean> = computed(
    (): boolean => this.name().trim().length > 0 && this.location() !== null,
  );

  /**
   * Gets where the project's folder would be made, or null until the name and place are known.
   */
  public readonly target: Signal<string | null> = this.destination.target;

  /**
   * Gets what is missing before a workspace can be made, or null when nothing is.
   */
  public readonly detailsProblem: Signal<string | null> = computed((): string | null =>
    this.toWorkspace() ? this.destination.problem() : null,
  );

  /**
   * Gets the message as it will be sent, for the Summary step: written as though no project had been
   * made yet, then completed with where it was made when it is.
   */
  public readonly message: Signal<string> = computed((): string =>
    projectMessage(this.messageInput(this.previewMade())),
  );

  /**
   * Starts reading what the machine can do: where projects go, the accounts, and whether a repository
   * can be made in place. Read once; the draft keeps it after.
   */
  public initialise(): void {
    if (this.initialised) {
      return;
    }
    this.initialised = true;
    this.destination.initialise();
  }

  /**
   * Gets whether the user put anything into a step.
   * @param step The step.
   * @returns Returns true when they did.
   */
  public touched(step: CreateStep): boolean {
    switch (step) {
      case 'start':
        return this.template() !== null || this.idea().trim().length > 0;
      case 'details':
        return (
          this.summary().trim().length > 0 ||
          this.name().trim().length > 0 ||
          this.repository() !== null ||
          this.documents().length > 0
        );
      case 'technology':
        return this.technologies().size > 0;
      case 'options':
        return this.options().size > 0;
      case 'skills':
        return this.skills().size > 0;
      case 'summary':
        return true;
    }
  }

  /**
   * Shows a step, remembering it was visited.
   * @param step The step.
   */
  public goTo(step: CreateStep): void {
    this.step.set(step);
    this.visited.update(
      (visited: ReadonlySet<CreateStep>): ReadonlySet<CreateStep> => new Set([...visited, step]),
    );
    this.error.set(null);
  }

  /**
   * Moves forwards or backwards a step.
   * @param by The number of steps to move: 1 or -1.
   */
  public move(by: 1 | -1): void {
    const index: number = CREATE_STEPS.indexOf(this.step()) + by;
    if (index >= 0 && index < CREATE_STEPS.length) {
      this.goTo(CREATE_STEPS[index]);
    }
  }

  /**
   * Chooses a template, or clears it when it is the one chosen. A template replaces the user's own
   * description: what is being built is one or the other.
   * @param template The template.
   */
  public chooseTemplate(template: ProjectTemplate): void {
    this.template.update((current: ProjectTemplate | null): ProjectTemplate | null =>
      current?.skill === template.skill ? null : template,
    );
    this.idea.set('');
  }

  /**
   * Records the user's own description, which replaces a template.
   * @param text The description.
   */
  public describe(text: string): void {
    this.idea.set(text);
    if (text.trim().length > 0) {
      this.template.set(null);
    }
  }

  /**
   * Records the repository picked, picking the sole account when a hosted one has only one.
   * @param repository The repository.
   */
  public setRepository(repository: ProjectRepository | null): void {
    this.destination.setRepository(repository);
  }

  /**
   * Asks where the project goes, in the main process's folder dialog.
   * @returns Resolves once the dialog has closed.
   */
  public browse(): Promise<void> {
    return this.destination.browse();
  }

  /**
   * Asks for supporting documents and attaches those that can be, replacing one of the same path.
   * @returns Resolves once the dialog has closed and the documents are read.
   */
  public async addDocuments(): Promise<void> {
    const picked: PickedDocuments = await this.newProject.pickDocuments();
    this.documents.update((documents: readonly ProjectDocument[]): readonly ProjectDocument[] => [
      ...documents.filter(
        (document: ProjectDocument): boolean =>
          !picked.documents.some((added: ProjectDocument): boolean => added.path === document.path),
      ),
      ...picked.documents,
    ]);
    this.skippedDocuments.set(picked.skipped);
  }

  /**
   * Removes a supporting document.
   * @param path The document's path.
   */
  public removeDocument(path: string): void {
    this.documents.update((documents: readonly ProjectDocument[]): readonly ProjectDocument[] =>
      documents.filter((document: ProjectDocument): boolean => document.path !== path),
    );
  }

  /**
   * Toggles a technology.
   * @param id Its id.
   */
  public toggleTechnology(id: string): void {
    this.technologies.update((selected: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(selected);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /**
   * Adds a technology the catalogue does not list, under Other, and selects it — or selects the one
   * already listed under that name or alias.
   * @param name What the user typed.
   */
  public addTechnology(name: string): void {
    const wanted: string = name.trim();
    const needle: string = wanted.toLowerCase();
    if (wanted.length === 0) {
      return;
    }
    const existing: Technology | undefined = this.catalogue().find(
      (technology: Technology): boolean =>
        technology.name.toLowerCase() === needle ||
        technology.aliases.some((alias: string): boolean => alias.toLowerCase() === needle),
    );
    if (existing !== undefined) {
      this.technologies.update(
        (selected: ReadonlySet<string>): ReadonlySet<string> =>
          new Set<string>([...selected, existing.id]),
      );
      return;
    }
    const added: Technology = {
      id: `own:${needle}`,
      name: wanted,
      category: 'other',
      description: 'Added by you',
      aliases: [],
      local: true,
    };
    this.ownTechnologies.update((own: readonly Technology[]): readonly Technology[] => [
      ...own,
      added,
    ]);
    this.technologies.update(
      (selected: ReadonlySet<string>): ReadonlySet<string> =>
        new Set<string>([...selected, added.id]),
    );
  }

  /**
   * Answers an option, or clears it.
   * @param id The option's id.
   * @param value The choice's value, or empty to clear it.
   */
  public setOption(id: string, value: string): void {
    this.options.update((options: ReadonlyMap<string, string>): ReadonlyMap<string, string> => {
      const next: Map<string, string> = new Map<string, string>(options);
      if (value.length === 0) {
        next.delete(id);
      } else {
        next.set(id, value);
      }
      return next;
    });
  }

  /**
   * Imports a skill into the library, through the platform dialog, and chooses it.
   * @returns Resolves once the dialog has closed and the library is current.
   */
  public async importSkill(): Promise<void> {
    this.skillImportError.set(null);
    const result: SkillSaveResult | null = await this.skillLibrary.import();
    if (result === null) {
      return;
    }
    if (result.skill === null) {
      this.skillImportError.set(result.error ?? 'The skill could not be imported.');
      return;
    }
    const name: string = result.skill.name;
    this.skills.update(
      (selected: ReadonlySet<string>): ReadonlySet<string> => new Set<string>([...selected, name]),
    );
  }

  /**
   * Toggles a skill to follow.
   * @param name The skill's name.
   */
  public toggleSkill(name: string): void {
    this.skills.update((selected: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(selected);
      if (!next.delete(name)) {
        next.add(name);
      }
      return next;
    });
  }

  /**
   * Clears the draft and returns to the first step. What the machine can do, and where projects go,
   * are kept.
   */
  public reset(): void {
    this.step.set('start');
    this.visited.set(new Set<CreateStep>(['start']));
    this.template.set(null);
    this.idea.set('');
    this.summary.set('');
    this.name.set('');
    this.repository.set(null);
    this.layout.set(null);
    this.account.set(null);
    this.documents.set([]);
    this.skippedDocuments.set([]);
    this.technologies.set(new Set<string>());
    this.ownTechnologies.set([]);
    this.options.set(new Map<string, string>());
    this.skills.set(new Set<string>());
    this.skillImportError.set(null);
    this.error.set(null);
  }

  /**
   * Sends the draft to an agent: in a workspace made for it when there is a name and a place, in the
   * agent's own tab otherwise. The draft is cleared once it has gone.
   * @returns Resolves with true once the agent has it, or false when it could not be sent.
   */
  public async send(): Promise<boolean> {
    if (this.sending()) {
      return false;
    }
    this.error.set(null);
    if (!this.toWorkspace()) {
      const tab: Tab = this.tabs.open('agent');
      this.workspaces.setAgentStart(tab.id, this.agentStart(null));
      this.log.info('welcome', 'New project sent to an agent tab');
      this.reset();
      return true;
    }
    const problem: string | null = this.detailsProblem();
    const repository: NewProjectRepository | null = this.destination.repositoryRequest();
    if (problem !== null || repository === null) {
      // Shown on the Details step, where it can be put right: moving there first, since a move clears
      // what the last step said.
      this.goTo('details');
      this.error.set(problem ?? 'Finish the project details first.');
      return false;
    }
    const name: string = this.name().trim();
    this.sending.set(true);
    try {
      const outcome: NewProjectOutcome = await this.newProject.create({ name, repository });
      if (!outcome.ok) {
        this.error.set(outcome.error);
        return false;
      }
      const made: MadeProject = {
        name,
        path: outcome.path,
        repository: describeRepository(repository),
      };
      if (!(await this.fileOpener.reopenDirectory(outcome.path, this.agentStart(made)))) {
        this.error.set(`${name} was made at ${outcome.path}, but it could not be opened.`);
        return false;
      }
      this.log.info('welcome', 'New project sent to its workspace agent', outcome.path);
      this.reset();
      return true;
    } finally {
      this.sending.set(false);
    }
  }

  /**
   * Describes how the agent starts: the first message, the brief, and the documents it carries.
   * @param made The project made, or null when there is none yet.
   * @returns Returns the start.
   */
  private agentStart(made: MadeProject | null): WorkspaceAgentStart {
    const documents: readonly ProjectDocument[] = this.documents();
    return {
      prompt: projectMessage(this.messageInput(made)),
      brief: projectBrief(made !== null, this.skillsToFollow()),
      context: documents.flatMap((document: ProjectDocument) =>
        document.kind === 'text'
          ? [{ path: document.path, kind: 'selection' as const, content: document.content }]
          : [],
      ),
      images: documents.flatMap((document: ProjectDocument) =>
        document.kind === 'image'
          ? [{ mediaType: document.mediaType, data: document.data, name: document.name }]
          : [],
      ),
    };
  }

  /**
   * Gets the skills the agent follows: the template's, then those the user chose, as the library
   * has them.
   * @returns Returns the skills.
   */
  private skillsToFollow(): readonly Skill[] {
    const wanted: string[] = [
      ...(this.template() === null ? [] : [this.template()!.skill]),
      ...this.skills(),
    ];
    return wanted
      .map((name: string): Skill | undefined =>
        this.availableSkills().find((skill: Skill): boolean => skill.name === name),
      )
      .filter((skill: Skill | undefined): skill is Skill => skill !== undefined);
  }

  /**
   * Describes the project a workspace would be made as, for the Summary's preview.
   * @returns Returns it, or null when the draft goes to an agent tab.
   */
  private previewMade(): MadeProject | null {
    const target: string | null = this.target();
    const repository: NewProjectRepository | null = this.destination.repositoryRequest();
    return !this.toWorkspace() || target === null
      ? null
      : {
          name: this.name().trim(),
          path: target,
          repository: repository === null ? null : describeRepository(repository),
        };
  }

  /**
   * Gathers the draft as plain values for the message.
   * @param made The project made, or null.
   * @returns Returns the values.
   */
  private messageInput(made: MadeProject | null): ProjectMessageInput {
    const template: ProjectTemplate | null = this.template();
    const idea: string = this.idea().trim();
    const selected: ReadonlySet<string> = this.technologies();
    const chosen: readonly Technology[] = this.catalogue().filter(
      (technology: Technology): boolean => selected.has(technology.id),
    );
    return {
      goal:
        template !== null
          ? { kind: 'template', text: template.goal }
          : idea.length > 0
            ? { kind: 'idea', text: idea }
            : null,
      made,
      name: made === null && this.name().trim().length > 0 ? this.name().trim() : null,
      summary: this.summary(),
      technologies: TECHNOLOGY_CATEGORIES.map((category: TechnologyCategory) => ({
        category: TECHNOLOGY_CATEGORY_LABELS[category],
        names: chosen
          .filter((technology: Technology): boolean => technology.category === category)
          .map((technology: Technology): string => technology.name),
      })).filter((group): boolean => group.names.length > 0),
      options: PROJECT_OPTIONS.flatMap((option: ProjectOption) => {
        const choice: ProjectOptionChoice | undefined = option.choices.find(
          (candidate: ProjectOptionChoice): boolean =>
            candidate.value === this.options().get(option.id),
        );
        return choice === undefined ? [] : [{ label: option.label, phrase: choice.phrase }];
      }),
      skills: [...this.skills()],
      documents: this.documents().map((document: ProjectDocument): string => document.name),
    };
  }
}
