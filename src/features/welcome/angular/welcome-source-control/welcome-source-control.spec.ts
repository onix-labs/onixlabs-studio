import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { TabType } from '@shared/angular/services/tabs/tab';
import { HostedAccount, HostedRepository, WelcomeSourceControl } from './welcome-source-control';

/**
 * Exposes the signals a hosting plugin will feed, so the spec can stand in for one.
 */
interface SourceInternals {
  readonly accounts: WritableSignal<readonly HostedAccount[]>;
  readonly repositories: WritableSignal<readonly HostedRepository[]>;
}

/**
 * Builds a repository with sensible defaults.
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

describe('WelcomeSourceControl', () => {
  let fixture: ComponentFixture<WelcomeSourceControl>;
  let host: HTMLElement;
  let internals: SourceInternals;
  let opened: TabType[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [WelcomeSourceControl] }).compileComponents();
    fixture = TestBed.createComponent(WelcomeSourceControl);
    internals = fixture.componentInstance as unknown as SourceInternals;
    opened = [];
    fixture.componentInstance.openTab.subscribe((type: TabType): void => void opened.push(type));
    await fixture.whenStable();
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Types a clone URL.
   * @param url The URL.
   */
  async function typeUrl(url: string): Promise<void> {
    const input: HTMLInputElement = host.querySelector<HTMLInputElement>('.source__field input')!;
    input.value = url;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  /**
   * Connects stand-in accounts and repositories, as a hosting plugin will.
   */
  async function connect(): Promise<void> {
    internals.accounts.set([
      { id: 'gh', host: 'GitHub', login: 'matthew' },
      { id: 'gl', host: 'GitLab', login: 'matthew' },
    ]);
    internals.repositories.set([
      repository('aero', { starred: true }),
      repository('stride', { private: true }),
      repository('infra', { accountId: 'gl', fork: true }),
      repository('old', { archived: true, updatedAt: Date.now() - 90 * 24 * 60 * 60 * 1000 }),
    ]);
    await fixture.whenStable();
  }

  /**
   * Gets the names of the listed repositories.
   * @returns Returns them, in order.
   */
  function listed(): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.welcome__repository-name')).map(
      (name: HTMLElement): string => name.textContent.trim(),
    );
  }

  it('withNoAccounts_saysSo_andOffersThePluginManager', () => {
    expect(host.querySelector('.source__empty-title')?.textContent).toContain(
      'No accounts connected',
    );

    host.querySelector<HTMLButtonElement>('.source__empty .source__secondary')!.click();

    expect(opened).toEqual(['plugin-manager']);
  });

  it('clone_isDisabled_untilTheFieldHoldsACloneUrl', async () => {
    const clone: HTMLButtonElement = host.querySelector<HTMLButtonElement>('.source__clone')!;
    expect(clone.disabled).toBe(true);

    await typeUrl('not a url');
    expect(clone.disabled).toBe(true);

    for (const url of [
      'https://github.com/owner/repo.git',
      'git@github.com:owner/repo.git',
      'ssh://git@host/owner/repo',
    ]) {
      await typeUrl(url);
      expect(clone.disabled).toBe(false);
    }
  });

  it('clone_saysWhyItCannotYet', async () => {
    await typeUrl('https://github.com/owner/repo.git');

    host.querySelector<HTMLButtonElement>('.source__clone')!.click();
    await fixture.whenStable();

    expect(host.querySelector('.source__notice')?.textContent).toContain('version-control plugins');
  });

  it('layout_isChosenBeforeCloning', async () => {
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

  it('withAccounts_listsRepositories_mostRecentFirst', async () => {
    await connect();

    expect(listed()).toEqual(['aero', 'stride', 'infra', 'old']);
    expect(host.querySelector('.source__accounts-empty')).toBeNull();
  });

  it('browseViews_filterTheList', async () => {
    await connect();
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
    expect(listed()).toEqual(['aero']);
    await view('Private');
    expect(listed()).toEqual(['stride']);
    await view('Forks');
    expect(listed()).toEqual(['infra']);
    await view('Archived');
    expect(listed()).toEqual(['old']);
    await view('Recent');
    expect(listed()).toEqual(['aero', 'stride', 'infra']);
  });

  it('hostPills_andSearch_filterTheList', async () => {
    await connect();

    Array.from(host.querySelectorAll<HTMLButtonElement>('.source__host'))
      .find((pill: HTMLButtonElement): boolean => pill.textContent?.includes('GitLab') ?? false)
      ?.click();
    await fixture.whenStable();
    expect(listed()).toEqual(['infra']);

    host.querySelector<HTMLButtonElement>('.source__host')!.click();
    const search: HTMLInputElement = host.querySelector<HTMLInputElement>('.source__search input')!;
    search.value = 'STRIDE';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(listed()).toEqual(['stride']);
  });

  it('selectingARepository_showsItsDetails_andCloningPutsItsUrlInTheField', async () => {
    await connect();

    host.querySelector<HTMLButtonElement>('.welcome__repository')!.click();
    await fixture.whenStable();

    expect(host.querySelector('.source__detail-name')?.textContent).toContain('aero');
    host.querySelector<HTMLButtonElement>('.source__detail .source__clone')!.click();
    await fixture.whenStable();
    expect(host.querySelector<HTMLInputElement>('.source__field input')!.value).toBe(
      'https://github.com/matthew/aero.git',
    );
  });
});
