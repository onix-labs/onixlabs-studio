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
  let parent: string | null;
  let picked: string | null;
  let clones: CloneRequest[];
  let cloneOutcome: CloneOutcome;
  let reopened: string[];

  beforeEach(async () => {
    plugins = signal<readonly PluginSummary[]>([
      installed('version-control'),
      installed('hosting'),
    ]);
    hosts = [];
    parent = '/Users/me/Development';
    picked = null;
    clones = [];
    cloneOutcome = { ok: true, path: '/Users/me/Development/repo' };
    reopened = [];
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
          },
        },
        {
          provide: Clone,
          useValue: {
            parent: (): Promise<string | null> => Promise.resolve(parent),
            pickParent: (): Promise<string | null> => Promise.resolve(picked),
            clone: (request: CloneRequest): Promise<CloneOutcome> => {
              clones.push(request);
              return Promise.resolve(cloneOutcome);
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
   * Gets the names of the listed repositories.
   * @returns Returns them, in order.
   */
  function names(): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.welcome__repository-name')).map(
      (name: HTMLElement): string => name.textContent.trim(),
    );
  }

  /**
   * Gets the labels of the browse views offered.
   * @returns Returns them, in order.
   */
  function views(): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.source__browse-label')).map(
      (label: HTMLElement): string => label.textContent.trim(),
    );
  }

  it('listsTheRepositoriesOfEverySignedInHost_andOffersToSignInToTheRest', async () => {
    hosts = [
      { host: 'github.com', provider: 'GitHub', status: { authenticated: true } },
      { host: 'gitlab.com', provider: 'GitLab', status: { authenticated: false } },
    ] as unknown as ForgeHostAccount[];

    await render();

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

    expect(views()).toEqual(['All Repositories', 'Recent', 'Private']);

    internals.repositories.set([repository('aero', { starred: true })]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(views()).toEqual([
      'All Repositories',
      'Starred',
      'Recent',
      'Private',
      'Forks',
      'Archived',
    ]);
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

  it('clone_isDisabled_untilTheFieldHoldsACloneUrl', async () => {
    await render();
    const clone: HTMLButtonElement = host.querySelector<HTMLButtonElement>('.source__clone')!;
    expect(clone.disabled).toBe(true);

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
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Folder name"]')!.value).toBe(
      'repo',
    );
    host.querySelectorAll<HTMLButtonElement>('.source__layout-option')[1].click();
    await type('Branch', 'develop');

    host.querySelector<HTMLButtonElement>('.source__clone')!.click();
    await fixture.whenStable();

    expect(clones).toEqual([
      {
        url: 'https://github.com/owner/repo.git',
        name: 'repo',
        layout: 'worktree',
        branch: 'develop',
      },
    ]);
    expect(reopened).toEqual(['/Users/me/Development/repo']);
    expect(openedCount).toBe(1);
  });

  it('clone_asksWhereFirst_whenNoFolderIsChosen_andStopsIfCancelled', async () => {
    parent = null;
    await render();
    await type('Repository URL', 'https://github.com/owner/repo.git');

    host.querySelector<HTMLButtonElement>('.source__clone')!.click();
    await fixture.whenStable();
    expect(clones).toEqual([]);

    picked = '/Users/me/Code';
    host.querySelector<HTMLButtonElement>('.source__clone')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(clones.length).toBe(1);
    expect(host.querySelector('.source__destination-path')?.textContent).toContain(
      '/Users/me/Code',
    );
  });

  it('clone_saysWhyItFailed', async () => {
    cloneOutcome = { ok: false, error: 'Authentication failed for the repository.' };
    await render();
    await type('Repository URL', 'https://github.com/owner/private.git');

    host.querySelector<HTMLButtonElement>('.source__clone')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('.source__error')?.textContent).toContain('Authentication failed');
    expect(openedCount).toBe(0);
  });

  it('layout_isChosenBeforeCloning', async () => {
    await render();
    const options: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.source__layout-option'),
    );
    expect(
      options.map((option: HTMLButtonElement): string | null =>
        option.getAttribute('aria-checked'),
      ),
    ).toEqual(['true', 'false']);

    options[1].click();
    await fixture.whenStable();

    expect(options[1].getAttribute('aria-checked')).toBe('true');
    expect(options[0].getAttribute('aria-checked')).toBe('false');
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
      const view: (label: string) => Promise<void> = async (label: string): Promise<void> => {
        Array.from(host.querySelectorAll<HTMLButtonElement>('.source__browse-item'))
          .find(
            (item: HTMLButtonElement): boolean =>
              item.querySelector('.source__browse-label')?.textContent?.trim() === label,
          )
          ?.click();
        await fixture.whenStable();
      };

      await view('Starred');
      expect(names()).toEqual(['aero']);
      await view('Private');
      expect(names()).toEqual(['stride']);
      await view('Forks');
      expect(names()).toEqual(['infra']);
      await view('Archived');
      expect(names()).toEqual(['old']);
      await view('Recent');
      expect(names()).toEqual(['aero', 'stride', 'infra']);
    });

    it('hostPills_andSearch_filterTheList', async () => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('.source__host'))
        .find((pill: HTMLButtonElement): boolean => pill.textContent?.includes('GitLab') ?? false)
        ?.click();
      await fixture.whenStable();
      expect(names()).toEqual(['infra']);

      host.querySelector<HTMLButtonElement>('.source__host')!.click();
      await type('Search repositories', 'STRIDE');
      expect(names()).toEqual(['stride']);
    });

    it('selectingARepository_showsItsDetails_andCloningPutsItsUrlInTheField', async () => {
      host.querySelector<HTMLButtonElement>('.welcome__repository')!.click();
      await fixture.whenStable();

      expect(host.querySelector('.source__detail-name')?.textContent).toContain('aero');
      host.querySelector<HTMLButtonElement>('.source__detail .source__clone')!.click();
      await fixture.whenStable();
      expect(
        host.querySelector<HTMLInputElement>('input[aria-label="Repository URL"]')!.value,
      ).toBe('https://github.com/matthew/aero.git');
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
