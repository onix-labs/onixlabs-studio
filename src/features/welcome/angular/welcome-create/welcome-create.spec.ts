import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { ForgeHostAccount, ForgeResult } from '@shared/api/forge-types';
import type { HostedAccount } from '@shared/api/hosting-protocol';
import type { NewProjectOutcome, NewProjectRequest } from '@shared/api/new-project-channels';
import type { PluginSummary } from '@shared/api/plugin-channels';
import type { Skill } from '@shared/api/skill-channels';
import type { VersionControlPluginInfo } from '@shared/api/source-control-channels';
import type { VersionControlCapability } from '@shared/api/version-control-protocol';
import { Clone } from '@shared/angular/services/clone/clone';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Forge } from '@shared/angular/services/forge/forge';
import { NewProject } from '@shared/angular/services/new-project/new-project';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Skills } from '@shared/angular/services/skills/skills';
import type { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { WorkspaceAgentStart, Workspaces } from '@shared/angular/services/workspaces/workspaces';
import { agentStart, ProjectStarter, WelcomeCreate } from './welcome-create';

/**
 * Builds an installed plugin filling a slot.
 * @param slot The slot.
 * @returns Returns its summary.
 */
function installed(
  slot: 'version-control' | 'hosting',
  capabilities: readonly string[] = slot === 'version-control' ? ['clone', 'init'] : [],
): PluginSummary {
  return {
    id: `test.${slot}`,
    state: 'installed',
    contributions: [{ slot, id: `test.${slot}`, capabilities }],
  } as unknown as PluginSummary;
}

describe('WelcomeCreate', () => {
  let fixture: ComponentFixture<WelcomeCreate>;
  let host: HTMLElement;
  let plugins: WritableSignal<readonly PluginSummary[]>;
  let remembered: string | null;
  let picked: string | null;
  let accounts: HostedAccount[];
  let created: NewProjectRequest[];
  let outcome: NewProjectOutcome;
  let opened: { path: string; start: WorkspaceAgentStart | undefined }[];
  let openedCount: number;
  let skills: Skill[];
  let running: VersionControlCapability[];

  beforeEach(async () => {
    plugins = signal<readonly PluginSummary[]>([
      installed('version-control'),
      installed('hosting'),
    ]);
    remembered = '/Users/me/Development';
    picked = '/Users/me/Projects';
    accounts = [{ login: 'matthew', name: null, kind: 'user' }];
    created = [];
    outcome = { ok: true, path: '/Users/me/Development/todo-app' };
    opened = [];
    openedCount = 0;
    skills = [];
    running = ['clone', 'init'];
    await TestBed.configureTestingModule({
      imports: [WelcomeCreate],
      providers: [
        { provide: Plugins, useValue: { plugins } },
        {
          provide: Clone,
          useValue: {
            parent: (): Promise<string | null> => Promise.resolve(remembered),
            pickParent: (): Promise<string | null> => Promise.resolve(picked),
          },
        },
        {
          provide: Forge,
          useValue: {
            isAvailable: true,
            hosts: (): Promise<readonly ForgeHostAccount[]> =>
              Promise.resolve([
                {
                  host: 'github.com',
                  provider: 'GitHub',
                  status: { authenticated: true },
                } as unknown as ForgeHostAccount,
              ]),
            accounts: (): Promise<ForgeResult<readonly HostedAccount[]>> =>
              Promise.resolve({ ok: true, value: accounts }),
          },
        },
        {
          provide: NewProject,
          useValue: {
            create: (request: NewProjectRequest): Promise<NewProjectOutcome> => {
              created.push(request);
              return Promise.resolve(outcome);
            },
          },
        },
        {
          provide: FileOpener,
          useValue: {
            reopenDirectory: (path: string, start?: WorkspaceAgentStart): Promise<boolean> => {
              opened.push({ path, start });
              return Promise.resolve(true);
            },
          },
        },
        { provide: Skills, useValue: { skills: (): readonly Skill[] => skills } },
        {
          provide: SourceControl,
          useValue: {
            client: {
              listPlugins: (): Promise<readonly VersionControlPluginInfo[]> =>
                Promise.resolve([
                  { id: 'test.git', installed: true, capabilities: running },
                ] as unknown as VersionControlPluginInfo[]),
            },
          },
        },
      ],
    }).compileComponents();
  });

  /**
   * Creates the component and lets its remembered location arrive.
   */
  async function render(): Promise<void> {
    fixture = TestBed.createComponent(WelcomeCreate);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.opened.subscribe((): void => {
      openedCount += 1;
    });
    await fixture.whenStable();
  }

  /**
   * Clicks the first starter, Create Something, and lets the project be made.
   */
  async function startGeneral(): Promise<void> {
    host.querySelector<HTMLButtonElement>('.create__starter')!.click();
    await fixture.whenStable();
  }

  /**
   * Types a project name.
   * @param text The name.
   */
  async function typeName(text: string): Promise<void> {
    const input: HTMLInputElement = host.querySelector<HTMLInputElement>('#create-name')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  /**
   * Picks a value in one of the form's dropdowns.
   * @param label The dropdown's accessible name.
   * @param value The value.
   */
  async function choose(label: string, value: string): Promise<void> {
    const select: HTMLSelectElement = host.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`,
    )!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  /**
   * Gets the values a dropdown offers, without its placeholder.
   * @param label The dropdown's accessible name.
   * @returns Returns them, in order.
   */
  function offered(label: string): string[] {
    return Array.from(
      host.querySelectorAll<HTMLOptionElement>(`select[aria-label="${label}"] option`),
    )
      .filter((option: HTMLOptionElement): boolean => !option.hidden)
      .map((option: HTMLOptionElement): string => option.value);
  }

  /**
   * Gets the line saying where starting opens the agent.
   * @returns Returns its text.
   */
  function destination(): string {
    return host.querySelector('.create__destination')?.textContent.trim() ?? '';
  }

  it('location_startsAtTheRememberedFolder', async () => {
    await render();

    expect(host.querySelector('.create__path')!.textContent.trim()).toBe('/Users/me/Development');
  });

  it('browse_changesTheLocation', async () => {
    await render();

    host.querySelector<HTMLButtonElement>('.create__browse')!.click();
    await fixture.whenStable();

    expect(host.querySelector('.create__path')!.textContent.trim()).toBe('/Users/me/Projects');
  });

  it('repository_offersOnlyWhatThePluginsCanMake', async () => {
    await render();
    expect(offered('Repository')).toEqual(['none', 'local', 'public', 'private']);

    plugins.set([installed('version-control')]);
    await fixture.whenStable();
    expect(offered('Repository')).toEqual(['none', 'local']);

    plugins.set([]);
    await fixture.whenStable();
    expect(offered('Repository')).toEqual(['none']);
  });

  it('local_isOfferedOnlyWhenTheRunningPluginCanInit_notWhenOnlyTheCatalogueSaysSo', async () => {
    // The catalogue's entry can be newer than the copy installed: Git 0.2.0 installed while the index
    // already describes 0.3.0. Only the running plugin's handshake says what it can really do.
    running = ['clone'];
    await render();

    expect(offered('Repository')).toEqual(['none', 'public', 'private']);
  });

  it('layout_isAskedOnlyWhenThereIsARepository', async () => {
    await render();
    expect(host.querySelector('select[aria-label="Repository layout"]')).toBeNull();

    await choose('Repository', 'none');
    expect(host.querySelector('select[aria-label="Repository layout"]')).toBeNull();

    await choose('Repository', 'private');
    expect(host.querySelector('select[aria-label="Repository layout"]')).not.toBeNull();
  });

  it('emptyForm_opensTheAgentInItsOwnTab_withTheStartersStart_andStepsAside', async () => {
    await render();
    expect(destination()).toBe('');
    expect(host.querySelector('.create__lead')!.textContent).toContain('own tab');
    const flutter: HTMLButtonElement = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.create__starter'),
    ).find((row: HTMLButtonElement): boolean => row.textContent.includes('Flutter'))!;

    flutter.click();
    await fixture.whenStable();

    const tabs: readonly Tab[] = TestBed.inject(Tabs).tabs();
    expect(tabs.map((tab: Tab): string => tab.type)).toEqual(['agent']);
    const start: WorkspaceAgentStart | undefined = TestBed.inject(Workspaces).takeAgentStart(
      tabs[0].id,
    );
    expect(start?.brief).toContain('Flutter');
    expect(start?.brief).toContain('no name or folder yet');
    expect(created).toEqual([]);
    expect(openedCount).toBe(1);
  });

  it('completeForm_opensANewWorkspace_atTheTarget', async () => {
    await render();
    await typeName('todo-app');
    await choose('Repository', 'local');
    expect(destination()).toContain('Finish the details');

    await choose('Repository layout', 'flat');
    expect(destination()).toBe(
      'Choose a starter to create a workspace at /Users/me/Development/todo-app.',
    );
  });

  it('noRepository_makesTheFolder_opensIt_withTheAgentStart_andStepsAside', async () => {
    await render();
    await typeName('todo-app');
    await choose('Repository', 'none');

    await startGeneral();

    expect(created).toEqual([{ name: 'todo-app', repository: { kind: 'none' } }]);
    expect(opened).toHaveLength(1);
    expect(opened[0].path).toBe('/Users/me/Development/todo-app');
    expect(opened[0].start?.opening).toContain('todo-app is ready');
    expect(openedCount).toBe(1);
  });

  it('aHostedRepository_isMadeUnderTheSoleAccount_inTheLayoutPicked', async () => {
    await render();
    await typeName('todo-app');
    await choose('Repository', 'private');
    await choose('Repository layout', 'worktree');

    await startGeneral();

    expect(created).toEqual([
      {
        name: 'todo-app',
        repository: {
          kind: 'hosted',
          host: 'github.com',
          account: 'matthew',
          private: true,
          layout: 'worktree',
        },
      },
    ]);
  });

  it('aLocalRepository_isMadeInTheLayoutPicked', async () => {
    await render();
    await typeName('todo-app');
    await choose('Repository', 'local');
    await choose('Repository layout', 'worktree');

    await startGeneral();

    expect(created).toEqual([
      { name: 'todo-app', repository: { kind: 'local', layout: 'worktree' } },
    ]);
  });

  it('severalAccounts_waitForOneToBePicked', async () => {
    accounts = [
      { login: 'matthew', name: null, kind: 'user' },
      { login: 'onixlabs', name: null, kind: 'organization' },
    ] as HostedAccount[];
    await render();
    await typeName('todo-app');
    await choose('Repository', 'public');
    await choose('Repository layout', 'flat');
    expect(destination()).toContain('Finish the details');

    await choose('Account', 'github.com/onixlabs');
    await startGeneral();

    expect(created[0].repository).toMatchObject({ account: 'onixlabs', private: false });
  });

  it('aFailure_isShownAboveTheStarters_andNothingOpens', async () => {
    outcome = { ok: false, error: '/Users/me/Development/todo-app already exists.' };
    await render();
    await typeName('todo-app');
    await choose('Repository', 'none');

    await startGeneral();

    expect(host.querySelector('.create__main .create__notice--error')!.textContent).toContain(
      'already exists',
    );
    expect(opened).toEqual([]);
    expect(openedCount).toBe(0);
  });

  it('aNameWithTheRestUnfinished_isAskedToBeFinished_notGuessedAt', async () => {
    await render();
    await typeName('todo-app');

    await startGeneral();

    expect(host.querySelector('.create__notice--error')!.textContent).toContain(
      'clear the name to plan with the agent',
    );
    expect(created).toEqual([]);
    expect(TestBed.inject(Tabs).tabs()).toEqual([]);
    expect(openedCount).toBe(0);
  });

  it('aRepositoryPickedWithoutAName_stillPlansWithTheAgentFirst', async () => {
    await render();
    await choose('Repository', 'none');

    await startGeneral();

    expect(
      TestBed.inject(Tabs)
        .tabs()
        .map((tab: Tab): string => tab.type),
    ).toEqual(['agent']);
    expect(created).toEqual([]);
  });

  it('theRowStarted_showsTheProjectBeingMade', async () => {
    let finish: (value: NewProjectOutcome) => void = (): void => undefined;
    TestBed.inject(NewProject).create = (): Promise<NewProjectOutcome> =>
      new Promise<NewProjectOutcome>((resolve: (value: NewProjectOutcome) => void): void => {
        finish = resolve;
      });
    await render();
    await typeName('todo-app');
    await choose('Repository', 'none');

    host.querySelectorAll<HTMLButtonElement>('.create__starter')[2].click();
    await fixture.whenStable();

    const rows: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.create__starter'),
    );
    expect(
      rows.map((row: HTMLButtonElement): string | null => row.getAttribute('aria-busy')),
    ).toEqual(
      rows.map((_row: HTMLButtonElement, index: number): string =>
        index === 2 ? 'true' : 'false',
      ),
    );
    expect(rows.every((row: HTMLButtonElement): boolean => row.disabled)).toBe(true);
    finish({ ok: true, path: '/Users/me/Development/todo-app' });
  });

  it('theStartersSkill_isFoundInTheLibrary_byName', async () => {
    skills = [
      { name: 'new-web-app', enabled: true, body: 'Ask about hosting.' } as unknown as Skill,
    ];
    await render();
    await typeName('todo-app');
    await choose('Repository', 'none');
    const web: HTMLButtonElement = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.create__starter'),
    ).find((row: HTMLButtonElement): boolean => row.textContent.includes('Web Application'))!;

    web.click();
    await fixture.whenStable();

    expect(opened[0].start?.brief).toContain('Ask about hosting.');
  });

  it('noRepository_needsNoLayout', async () => {
    await render();
    await typeName('todo-app');
    await choose('Repository', 'none');

    expect(destination()).toContain('create a workspace at /Users/me/Development/todo-app');
  });

  it('anInvalidName_isExplained_andDoesNotCountAsComplete', async () => {
    await render();
    await typeName('my project/');
    await choose('Repository', 'none');

    expect(host.querySelector('.create__side .create__error')).not.toBeNull();
    expect(destination()).toContain('Finish the details');
  });

  it('editingTheForm_clearsTheError', async () => {
    outcome = { ok: false, error: 'Something went wrong.' };
    await render();
    await typeName('todo');
    await choose('Repository', 'none');
    await startGeneral();
    expect(host.querySelector('.create__notice--error')).not.toBeNull();

    await typeName('todo-app');

    expect(host.querySelector('.create__notice--error')).toBeNull();
  });
});

describe('agentStart', () => {
  const starter: ProjectStarter = {
    skill: 'new-cli-tool',
    title: 'Command-Line Tool',
    summary: 'A tool run from the terminal.',
    icon: undefined as never,
  };

  it('briefsTheAgent_onTheProject_andItsStarter', () => {
    const start: WorkspaceAgentStart = agentStart(starter, undefined, {
      name: 'todo',
      path: '/p/todo',
    });

    expect(start.brief).toContain('"todo", at /p/todo');
    expect(start.brief).toContain('Command-Line Tool');
    expect(start.brief).not.toContain('skill:');
  });

  it('carriesTheSkillsBody_whenTheLibraryHasIt', () => {
    const skill: Skill = { name: 'new-cli-tool', body: 'Ask about packaging.' } as Skill;

    expect(agentStart(starter, skill, null).brief).toContain(
      'Follow the "new-cli-tool" skill:\n\nAsk about packaging.',
    );
  });

  it('withoutAFolder_tellsTheAgentNotToCreateFiles', () => {
    const start: WorkspaceAgentStart = agentStart(starter, undefined, null);

    expect(start.brief).toContain('nowhere to create files');
    expect(start.opening).toBe('Tell the agent about your project to start planning it.');
  });
});
