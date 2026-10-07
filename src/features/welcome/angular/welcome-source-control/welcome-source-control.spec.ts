import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { CloneOutcome, CloneRequest } from '@shared/api/clone-channels';
import type { ForgeHostAccount, ForgeResult } from '@shared/api/forge-types';
import type {
  HostedAccount as ProtocolAccount,
  HostedRepository as ProtocolRepository,
} from '@shared/api/hosting-protocol';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Clone } from '@shared/angular/services/clone/clone';
import { Shell } from '@shared/angular/services/shell/shell';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Forge } from '@shared/angular/services/forge/forge';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import type { TabType } from '@shared/angular/services/tabs/tab';
import {
  HostedAccount,
  HostedRepository,
  nameFromUrl,
  WelcomeSourceControl,
} from './welcome-source-control';

/**
 * Exposes the signals the hosting plugins feed, so a spec can set the browser up directly.
 */
interface SourceInternals {
  readonly accounts: WritableSignal<readonly HostedAccount[]>;
  readonly repositories: WritableSignal<readonly HostedRepository[]>;
}

/**
 * Builds a repository with every optional fact, as a full hosting plugin supplies.
 * @param name Its name.
 * @param overrides The fields to override.
 * @returns Returns it.
 */
function repository(name: string, overrides: Partial<HostedRepository> = {}): HostedRepository {
  return {
    id: name,
    accountId: 'gh',
    name,
    fullName: `matthew/${name}`,
    description: `About ${name}`,
    language: 'C#',
    stars: 3,
    updatedAt: Date.now(),
    private: false,
    fork: false,
    archived: false,
    starred: false,
    cloneUrl: `https://github.com/matthew/${name}.git`,
    webUrl: `https://github.com/matthew/${name}`,
    ...overrides,
  };
}

/**
 * Builds an installed plugin filling a slot.
 * @param slot The slot.
 * @returns Returns its summary.
 */
function installed(slot: 'version-control' | 'hosting'): PluginSummary {
  return {
    id: `test.${slot}`,
    state: 'installed',
    contributions: [{ slot, id: `test.${slot}` }],
  } as unknown as PluginSummary;
}

/**
 * A protocol repository, as the GitHub plugin lists it today.
 * @param name Its name.
 * @param updatedAt When it was updated.
 * @returns Returns it.
 */
function listed(name: string, updatedAt: string): ProtocolRepository {
  return {
    ref: { host: 'github.com', owner: 'matthew', name },
    description: null,
    private: name === 'secret',
    defaultBranch: 'main',
    cloneUrl: `https://github.com/matthew/${name}.git`,
    webUrl: `https://github.com/matthew/${name}`,
    updatedAt,
  };
}

describe('WelcomeSourceControl', () => {
  let fixture: ComponentFixture<WelcomeSourceControl>;
  let host: HTMLElement;
  let internals: SourceInternals;
  let tabs: TabType[];
  let openedCount: number;
  let plugins: WritableSignal<readonly PluginSummary[]>;
  let hosts: ForgeHostAccount[];
  let picked: string | null;
  let clones: CloneRequest[];
  let cloneOutcome: CloneOutcome;
  let reopened: string[];
  let starred: ProtocolRepository[];
  let external: string[];

  beforeEach(async () => {
    plugins = signal<readonly PluginSummary[]>([
      installed('version-control'),
      installed('hosting'),
    ]);
    hosts = [];
    picked = '/Users/me/Development';
    clones = [];
    cloneOutcome = { ok: true, path: '/Users/me/Development/repo' };
    reopened = [];
    starred = [];
    external = [];
    await TestBed.configureTestingModule({
      imports: [WelcomeSourceControl],
      providers: [
        { provide: Plugins, useValue: { plugins } },
        {
          provide: Forge,
          useValue: {
            isAvailable: true,
            hosts: (): Promise<readonly ForgeHostAccount[]> => Promise.resolve(hosts),
            accounts: (): Promise<ForgeResult<readonly ProtocolAccount[]>> =>
              Promise.resolve({
                ok: true,
                value: [{ login: 'matthew', name: null, kind: 'user' }],
              }),
            repositories: (): Promise<ForgeResult<readonly ProtocolRepository[]>> =>
              Promise.resolve({
                ok: true,
                value: [
                  listed('aero', '2026-10-01T10:00:00Z'),
                  listed('secret', '2026-10-05T10:00:00Z'),
                ],
              }),
            starredRepositories: (): Promise<ForgeResult<readonly ProtocolRepository[]>> =>
              Promise.resolve({ ok: true, value: starred }),
          },
        },
        {
          provide: Clone,
          useValue: {
            pickParent: (): Promise<string | null> => Promise.resolve(picked),
            clone: (request: CloneRequest): Promise<CloneOutcome> => {
              clones.push(request);
              return Promise.resolve(cloneOutcome);
            },
          },
        },
        {
          provide: Shell,
          useValue: {
            openExternal: (url: string): Promise<void> => {
              external.push(url);
              return Promise.resolve();
            },
          },
        },
        {
          provide: FileOpener,
          useValue: {
            reopenDirectory: (path: string): Promise<boolean> => {
              reopened.push(path);
              return Promise.resolve(true);
            },
          },
        },
      ],
    }).compileComponents();
  });

  /**
   * Builds the section and lets its first read settle.
   */
  async function render(): Promise<void> {
    fixture = TestBed.createComponent(WelcomeSourceControl);
    internals = fixture.componentInstance as unknown as SourceInternals;
    tabs = [];
    openedCount = 0;
    fixture.componentInstance.openTab.subscribe((type: TabType): void => void tabs.push(type));
    fixture.componentInstance.opened.subscribe((): void => void (openedCount += 1));
    fixture.detectChanges();
    // The first read chains several requests, which whenStable does not wait for; waiting on a read of
    // the same data settles it, and stops it landing after a spec has set its own.
    await fixture.componentInstance.refresh();
    await fixture.whenStable();
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  }

  /**
   * Types into one of the section's text fields.
   * @param label The field's accessible label.
   * @param value The text.
   */
  async function type(label: string, value: string): Promise<void> {
    const input: HTMLInputElement = host.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    )!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  /**
   * Picks an option in one of the section's dropdowns.
   * @param label The dropdown's accessible label.
   * @param value The option's value.
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
   * Opens a sidebar section by clicking its header.
   * @param title The section's title.
   */
  async function expand(title: string): Promise<void> {
    Array.from(host.querySelectorAll<HTMLButtonElement>('.source__toggle'))
      .find(
        (toggle: HTMLButtonElement): boolean =>
          toggle.querySelector('.source__heading')?.textContent?.trim() === title,
      )!
      .click();
    await fixture.whenStable();
  }

  /**
   * Gets the names of the listed repositories.
   * @returns Returns them, in order.
   */
  function names(): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.welcome__repository-name')).map(
      (name: HTMLElement): string => name.textContent.trim(),
    );
  }

  /**
   * Gets the labels of the repository filter's choices, without their counts.
   * @param group The heading of the group to read, or null for the ungrouped views.
   * @returns Returns them, in order.
   */
  function filters(group: string | null = null): string[] {
    const select: HTMLSelectElement = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Show repositories"]',
    )!;
    return Array.from(select.querySelectorAll<HTMLOptionElement>('option'))
      .filter(
        (option: HTMLOptionElement): boolean =>
          (option.closest('optgroup')?.getAttribute('label') ?? null) === group,
      )
      .map((option: HTMLOptionElement): string =>
        option.textContent.trim().replace(/ \(\d+\)$/, ''),
      );
  }

  it('listsTheRepositoriesOfEverySignedInHost_andOffersToSignInToTheRest', async () => {
    hosts = [
      { host: 'github.com', provider: 'GitHub', status: { authenticated: true } },
      { host: 'gitlab.com', provider: 'GitLab', status: { authenticated: false } },
    ] as unknown as ForgeHostAccount[];

    await render();
    await expand('Connected Accounts');

    expect(names()).toEqual(['secret', 'aero']);
    expect(host.querySelector('.source__account-login')?.textContent).toContain('matthew');
    const signIn: HTMLButtonElement = host.querySelector<HTMLButtonElement>(
      '.source__account--signed-out',
    )!;
    expect(signIn.textContent).toContain('Sign in to gitlab.com');
    signIn.click();
    expect(tabs).toEqual(['settings']);
  });

  it('offersOnlyTheBrowseViewsTheDataSupports', async () => {
    // The GitHub plugin does not yet say whether a repository is starred, a fork or archived; a view
    // that reads one would claim something Studio was never told.
    hosts = [
      { host: 'github.com', provider: 'GitHub', status: { authenticated: true } },
    ] as unknown as ForgeHostAccount[];
    await render();

    expect(filters()).toEqual(['All Repositories', 'Recent', 'Private']);
    // One host has nothing to tell apart.
    expect(filters('Hosts')).toEqual([]);

    internals.repositories.set([repository('aero', { starred: true })]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(filters()).toEqual([
      'All Repositories',
      'Starred',
      'Recent',
      'Private',
      'Forks',
      'Archived',
    ]);
  });

  it('starredOtherPeoplesProjects_appearInStarredOnly', async () => {
    // Most of what a user stars is other people's: it belongs in Starred, not crowding their own list.
    hosts = [
      { host: 'github.com', provider: 'GitHub', status: { authenticated: true } },
    ] as unknown as ForgeHostAccount[];
    starred = [
      {
        ...listed('angular', '2026-10-06T10:00:00Z'),
        ref: { host: 'github.com', owner: 'angular', name: 'angular' },
        starred: true,
      },
      // One of the user's own, also starred: listed once.
      { ...listed('aero', '2026-10-01T10:00:00Z'), starred: true },
    ];
    await render();

    expect(names()).toEqual(['secret', 'aero']);
    expect(filters()).toContain('Starred');
    await choose('Show repositories', 'view:starred');
    expect(names()).toEqual(['angular']);
  });

  it('withNoHostingPlugin_saysWhatToInstall', async () => {
    plugins.set([installed('version-control')]);
    await render();

    expect(host.querySelector('.source__empty-title')?.textContent).toContain(
      'No hosting plugin installed',
    );
    host.querySelector<HTMLButtonElement>('.source__empty .source__secondary')!.click();
    expect(tabs).toEqual(['plugin-manager']);
  });

  it('withNoVersionControlPlugin_saysCloningNeedsOne', async () => {
    plugins.set([installed('hosting')]);
    await render();

    expect(host.querySelector('.source__side .source__clone')).toBeNull();
    expect(host.querySelector('.source__notice')?.textContent).toContain('Install Git');
  });

  it('clone_isDisabled_untilALayoutIsPicked_andTheFieldHoldsACloneUrl', async () => {
    await render();
    const clone: HTMLButtonElement = host.querySelector<HTMLButtonElement>('.source__clone')!;
    expect(clone.disabled).toBe(true);

    // Studio has no default layout: a URL alone is not enough.
    await type('Repository URL', 'https://github.com/owner/repo.git');
    expect(clone.disabled).toBe(true);
    await choose('Clone as', 'flat');

    await type('Repository URL', 'not a url');
    expect(clone.disabled).toBe(true);

    for (const url of [
      'https://github.com/owner/repo.git',
      'git@github.com:owner/repo.git',
      'ssh://git@host/owner/repo',
    ]) {
      await type('Repository URL', url);
      expect(clone.disabled).toBe(false);
    }
  });

  it('clones_inTheChosenLayout_thenOpensTheResultAndStepsAside', async () => {
    await render();
    await type('Repository URL', 'https://github.com/owner/repo.git');
    await choose('Clone as', 'worktree');

    host.querySelector<HTMLButtonElement>('.source__clone')!.click();
    await fixture.whenStable();

    expect(clones).toEqual([
      {
        url: 'https://github.com/owner/repo.git',
        // The folder is named after the repository.
        name: 'repo',
        layout: 'worktree',
      },
    ]);
    expect(reopened).toEqual(['/Users/me/Development/repo']);
    expect(openedCount).toBe(1);
  });

  it('clone_asksWhereEveryTime_andCancellingClonesNothing', async () => {
    // The folder dialog opens on every clone (on the folder used last), and is the user's last chance
    // to back out.
    picked = null;
    await render();
    await type('Repository URL', 'https://github.com/owner/repo.git');
    await choose('Clone as', 'flat');

    host.querySelector<HTMLButtonElement>('.source__clone')!.click();
    await fixture.whenStable();
    expect(clones).toEqual([]);

    picked = '/Users/me/Code';
    host.querySelector<HTMLButtonElement>('.source__clone')!.click();
    await fixture.whenStable();
    expect(clones.length).toBe(1);
    expect(reopened).toEqual(['/Users/me/Development/repo']);
  });

  it('clone_saysWhyItFailed', async () => {
    cloneOutcome = { ok: false, error: 'Authentication failed for the repository.' };
    await render();
    await type('Repository URL', 'https://github.com/owner/private.git');
    await choose('Clone as', 'flat');

    host.querySelector<HTMLButtonElement>('.source__clone')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('.source__error')?.textContent).toContain('Authentication failed');
    expect(openedCount).toBe(0);
  });

  it('sections_areASingleOpenAccordion_withCloneOpenFirst', async () => {
    await render();
    const open: () => string[] = (): string[] =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('.source__toggle'))
        .filter((toggle: HTMLButtonElement): boolean => toggle.ariaExpanded === 'true')
        .map((toggle: HTMLButtonElement): string => toggle.textContent.trim());

    expect(open()).toEqual(['Clone a Repository']);
    expect(host.querySelector('input[aria-label="Repository URL"]')).not.toBeNull();
    expect(host.querySelector('.source__connect')).toBeNull();

    await expand('Connected Accounts');
    expect(open()).toEqual(['Connected Accounts']);
    expect(host.querySelector('input[aria-label="Repository URL"]')).toBeNull();
    expect(host.querySelector('.source__connect')).not.toBeNull();

    await expand('Connected Accounts');
    expect(open()).toEqual([]);
  });

  it('layout_isChosenBeforeCloning_fromADropdown', async () => {
    await render();
    const select: HTMLSelectElement = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Clone as"]',
    )!;
    // "Clone As…" shows at rest, but is hidden from the list: it is not itself a choice.
    expect(select.value).toBe('');
    expect(
      Array.from(select.options).map(
        (option: HTMLOptionElement): string => `${option.value}:${option.hidden}`,
      ),
    ).toEqual([':true', 'flat:false', 'worktree:false']);
    expect(select.options[0].textContent?.trim()).toBe('Clone As…');
    expect(host.querySelector('.source__layout-choice .dropdown__label')?.textContent).toBe(
      'Clone As…',
    );

    await choose('Clone as', 'flat');
    expect(select.value).toBe('flat');
    expect(host.querySelector('.source__layout-choice .dropdown__label')?.textContent).toBe(
      'Flat Repository',
    );
  });

  describe('browsing', () => {
    beforeEach(async () => {
      await render();
      internals.accounts.set([
        { id: 'gh', host: 'GitHub', login: 'matthew' },
        { id: 'gl', host: 'GitLab', login: 'matthew' },
      ]);
      // Fixed, distinct update times: the list sorts on them, and stamping each with Date.now() let
      // two land a millisecond apart and swap.
      const now: number = Date.now();
      const hour: number = 60 * 60 * 1000;
      internals.repositories.set([
        repository('aero', { starred: true, updatedAt: now - hour }),
        repository('stride', { private: true, updatedAt: now - 2 * hour }),
        repository('infra', { accountId: 'gl', fork: true, updatedAt: now - 3 * hour }),
        repository('old', { archived: true, updatedAt: now - 90 * 24 * hour }),
      ]);
      await fixture.whenStable();
    });

    it('listsRepositories_mostRecentFirst', () => {
      expect(names()).toEqual(['aero', 'stride', 'infra', 'old']);
      expect(host.querySelector('.source__accounts-empty')).toBeNull();
    });

    it('browseViews_filterTheList', async () => {
      await choose('Show repositories', 'view:starred');
      expect(names()).toEqual(['aero']);
      await choose('Show repositories', 'view:private');
      expect(names()).toEqual(['stride']);
      await choose('Show repositories', 'view:forks');
      expect(names()).toEqual(['infra']);
      await choose('Show repositories', 'view:archived');
      expect(names()).toEqual(['old']);
      await choose('Show repositories', 'view:recent');
      expect(names()).toEqual(['aero', 'stride', 'infra']);
    });

    it('theFilter_offersHostsWhenThereIsMoreThanOne_withCounts', () => {
      expect(filters('Hosts')).toEqual(['GitHub', 'GitLab']);
      const select: HTMLSelectElement = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Show repositories"]',
      )!;
      expect(select.options[0].textContent.trim()).toBe('All Repositories (4)');
    });

    it('hosts_andSearch_filterTheList', async () => {
      await choose('Show repositories', 'host:GitLab');
      expect(names()).toEqual(['infra']);

      await choose('Show repositories', 'view:all');
      await type('Search repositories', 'STRIDE');
      expect(names()).toEqual(['stride']);
    });

    it('selectingARepository_showsItsDetails_andCloningPutsItsUrlInTheField', async () => {
      host.querySelector<HTMLButtonElement>('.welcome__repository')!.click();
      await fixture.whenStable();

      expect(host.querySelector('.source__detail-name')?.textContent).toContain('aero');
      // With the Clone section collapsed, cloning from the details opens it, so the URL is seen to land.
      await expand('Connected Accounts');
      host.querySelector<HTMLButtonElement>('.source__detail .source__clone')!.click();
      await fixture.whenStable();
      expect(
        host.querySelector<HTMLInputElement>('input[aria-label="Repository URL"]')!.value,
      ).toBe('https://github.com/matthew/aero.git');
    });

    it('details_showWhatTheHostSaid_andLeaveOutWhatItDidNot', async () => {
      const now: number = Date.now();
      internals.repositories.set([
        repository('aero', {
          starred: true,
          fork: true,
          archived: true,
          topics: ['ide', 'electron'],
          forks: 4,
          openIssues: 9,
          license: 'MIT',
          homepage: 'https://aero.dev',
          pushedAt: now - 2 * 24 * 60 * 60 * 1000,
          updatedAt: now,
        }),
        repository('plain'),
      ]);
      await fixture.whenStable();
      const facts: () => Record<string, string> = (): Record<string, string> =>
        Object.fromEntries(
          Array.from(host.querySelectorAll<HTMLElement>('.source__detail-facts dt')).map(
            (term: HTMLElement): [string, string] => [
              term.textContent.trim(),
              term.nextElementSibling?.textContent?.trim() ?? '',
            ],
          ),
        );
      const select: (name: string) => Promise<void> = async (name: string): Promise<void> => {
        Array.from(host.querySelectorAll<HTMLButtonElement>('.welcome__repository'))
          .find(
            (row: HTMLButtonElement): boolean =>
              row.querySelector('.welcome__repository-name')?.textContent?.trim() === name,
          )!
          .click();
        await fixture.whenStable();
      };

      await select('aero');
      expect(
        Array.from(host.querySelectorAll('.source__badge')).map((badge: Element): string =>
          badge.textContent.trim(),
        ),
      ).toEqual(['Starred', 'Fork', 'Archived']);
      expect(
        Array.from(host.querySelectorAll('.source__topic')).map((topic: Element): string =>
          topic.textContent.trim(),
        ),
      ).toEqual(['ide', 'electron']);
      expect(facts()).toEqual({
        Stars: '3',
        Forks: '4',
        'Open issues': '9',
        Language: 'C#',
        Licence: 'MIT',
        Visibility: 'Public',
        'Last pushed': '2d ago',
        'Last updated': 'today',
      });

      await select('plain');
      expect(host.querySelector('.source__badges')).toBeNull();
      expect(host.querySelector('.source__topics')).toBeNull();
      expect(host.querySelector('.source__detail-link')).toBeNull();
      expect(Object.keys(facts())).toEqual(['Stars', 'Language', 'Visibility', 'Last updated']);
    });

    it('details_close_fromTheirButton_orByPickingTheSameRepositoryAgain', async () => {
      const row: HTMLButtonElement = host.querySelector<HTMLButtonElement>('.welcome__repository')!;
      row.click();
      await fixture.whenStable();
      expect(host.querySelector('.source__detail')).not.toBeNull();

      host.querySelector<HTMLButtonElement>('.source__detail-close button')!.click();
      await fixture.whenStable();
      expect(host.querySelector('.source__detail')).toBeNull();

      row.click();
      await fixture.whenStable();
      row.click();
      await fixture.whenStable();
      expect(host.querySelector('.source__detail')).toBeNull();
    });

    it('details_openTheRepositoryAndItsHomepage_inTheBrowser', async () => {
      internals.repositories.set([repository('aero', { homepage: 'https://aero.dev' })]);
      await fixture.whenStable();
      host.querySelector<HTMLButtonElement>('.welcome__repository')!.click();
      await fixture.whenStable();

      const open: HTMLButtonElement = host.querySelector<HTMLButtonElement>('.source__open')!;
      expect(open.textContent.trim()).toBe('Open on GitHub');
      open.click();
      host.querySelector<HTMLButtonElement>('.source__detail-link')!.click();
      expect(external).toEqual(['https://github.com/matthew/aero', 'https://aero.dev']);
    });
  });
});

describe('nameFromUrl', () => {
  it('takesTheLastPart_withoutDotGit', () => {
    expect(nameFromUrl('https://github.com/owner/repo.git')).toBe('repo');
    expect(nameFromUrl('git@github.com:owner/repo.git')).toBe('repo');
    expect(nameFromUrl('https://github.com/owner/repo/')).toBe('repo');
    expect(nameFromUrl('')).toBe('');
  });
});
