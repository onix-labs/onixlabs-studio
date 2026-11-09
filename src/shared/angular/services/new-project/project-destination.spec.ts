import { Settings } from '@shared/angular/services/settings/settings';
import { TestBed } from '@angular/core/testing';
import { FakeProjectMachine } from '@features/welcome/angular/welcome-create/project-draft.testing';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { ProjectDestination } from './project-destination';

describe('ProjectDestination', () => {
  let machine: FakeProjectMachine;

  /**
   * Builds a destination over the fake machine, and lets it read what the machine offers.
   * @returns Returns the destination.
   */
  async function made(): Promise<ProjectDestination> {
    TestBed.configureTestingModule({ providers: machine.providers() });
    const destination: ProjectDestination = TestBed.runInInjectionContext(
      (): ProjectDestination => new ProjectDestination(),
    );
    destination.initialise();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    return destination;
  }

  beforeEach(() => {
    machine = new FakeProjectMachine();
  });

  afterEach(() => {
    localStorage.removeItem('settings');
    localStorage.removeItem('newProject.lastAccount');
  });

  it('readsWhereProjectsGo_andWhatRepositoriesCanBeMade', async () => {
    const destination: ProjectDestination = await made();

    expect(destination.location()).toBe('/Users/me/Development');
    expect(
      destination.repositoryOptions().map((option: DropdownOption): string => option.value),
    ).toEqual(['none', 'local', 'public', 'private']);
  });

  it('describesAHostedRepository_underTheSoleAccount', async () => {
    const destination: ProjectDestination = await made();
    destination.name.set('todo-app');

    destination.setRepository('private');
    destination.layout.set('flat');

    expect(destination.problem()).toBeNull();
    expect(destination.repositoryRequest()).toEqual({
      kind: 'hosted',
      host: 'github.com',
      account: 'matthew',
      private: true,
      layout: 'flat',
    });
  });

  it('followsDefaultCloneLayout_untilItSaysAsk', async () => {
    const before: ProjectDestination = await made();
    expect(before.layout()).toBeNull();

    TestBed.inject(Settings).set('versionControl.cloneLayout', 'worktree');
    const after: ProjectDestination = TestBed.runInInjectionContext(
      (): ProjectDestination => new ProjectDestination(),
    );
    expect(after.layout()).toBe('worktree');
  });

  it('remembersTheAccountLastUsed', async () => {
    machine.accounts = [
      { login: 'one', name: null, kind: 'user' },
      { login: 'two', name: null, kind: 'organization' },
    ];
    const first: ProjectDestination = await made();
    const id: string = first.accounts()[1].id;
    first.setRepository('public');
    expect(first.account()).toBeNull();
    first.chooseAccount(id);

    const next: ProjectDestination = TestBed.runInInjectionContext(
      (): ProjectDestination => new ProjectDestination(),
    );
    next.accounts.set(first.accounts());
    next.setRepository('public');

    expect(next.account()).toBe(id);
  });

  it('stopsAsking_oncePointedAtTheDefaultProjectsFolder', async () => {
    const destination: ProjectDestination = await made();
    expect(destination.asksWhere()).toBe(true);

    TestBed.inject(Settings).set('workspaces.askWhereToCreate', false);
    expect(destination.asksWhere()).toBe(false);

    // With nowhere to go it has to ask all the same.
    destination.location.set(null);
    expect(destination.asksWhere()).toBe(true);
  });

  it('saysWhatIsMissing', async () => {
    const destination: ProjectDestination = await made();

    destination.name.set('two words');
    expect(destination.problem()).toContain('letters, digits');

    destination.name.set('todo');
    destination.setRepository('local');
    expect(destination.problem()).toBe('Choose how the repository is laid out.');
    expect(destination.repositoryRequest()).toBeNull();
  });

  it('offersNoRepositoryAlone_withNothingToMakeOne', async () => {
    machine.plugins.set([]);

    const destination: ProjectDestination = await made();

    expect(
      destination.repositoryOptions().map((option: DropdownOption): string => option.value),
    ).toEqual(['none']);
  });
});
