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
