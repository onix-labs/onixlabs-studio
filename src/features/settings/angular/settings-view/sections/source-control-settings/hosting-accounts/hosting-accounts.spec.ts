import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PluginSummary } from '@shared/api/plugin-channels';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { ForgeAuthStatus, ForgeHostAccount } from '@shared/api/forge-types';
import { HostingAuthMode } from '@shared/api/hosting-protocol';
import { Forge } from '@shared/angular/services/forge/forge';
import { HostingAccounts } from './hosting-accounts';

/**
 * One row as the component holds it.
 */
interface Row {
  readonly account: ForgeHostAccount;
  readonly draft: string;
}

/**
 * The protected surface exercised by these tests.
 */
interface Internals {
  rows(): readonly Row[];
  loaded(): boolean;
  options(row: Row): readonly { value: string; label: string }[];
  modeOf(row: Row): string;
  offersToken(row: Row): boolean;
  canSave(row: Row): boolean;
  canClear(row: Row): boolean;
  onMode(row: Row, value: string): Promise<void>;
  onDraft(row: Row, value: string): void;
  onSave(row: Row): Promise<void>;
  onClear(row: Row): Promise<void>;
  refresh(): Promise<void>;
}

/**
 * Builds a host's account.
 * @param status Fields to vary in its status, from signed out.
 * @param overrides Fields to vary in the account.
 * @returns Returns the account.
 */
function account(
  status: Partial<ForgeAuthStatus> = {},
  overrides: Partial<ForgeHostAccount> = {},
): ForgeHostAccount {
  return {
    pluginId: 'onixlabs.github',
    provider: 'GitHub',
    host: 'github.com',
    authModes: ['cli', 'studio'],
    authMode: null,
    status: {
      mode: null,
      authenticated: false,
      hasStoredToken: false,
      identity: null,
      detail: 'Not signed in to github.com.',
      ...status,
    },
    ...overrides,
  };
}

/**
 * A recording stand-in for the forge client. There is deliberately no way to read a token back from
 * it — that is the seam's whole point, and the fake keeps it honest.
 */
class FakeForge {
  public readonly isAvailable: boolean = true;
  public hostsReads: number = 0;
  public readonly calls: unknown[][] = [];
  public listed: readonly ForgeHostAccount[] = [account()];
  public next: ForgeHostAccount | null = account();

  public hosts(): Promise<readonly ForgeHostAccount[]> {
    this.hostsReads += 1;
    return Promise.resolve(this.listed);
  }

  public setAuthMode(
    pluginId: string,
    host: string,
    mode: HostingAuthMode | null,
  ): Promise<ForgeHostAccount | null> {
    this.calls.push(['setAuthMode', pluginId, host, mode]);
    return Promise.resolve(this.next);
  }

  public setToken(pluginId: string, host: string, token: string): Promise<ForgeHostAccount | null> {
    this.calls.push(['setToken', pluginId, host, token]);
    return Promise.resolve(this.next);
  }

  public clearToken(pluginId: string, host: string): Promise<ForgeHostAccount | null> {
    this.calls.push(['clearToken', pluginId, host]);
    return Promise.resolve(this.next);
  }
}

describe('HostingAccounts', () => {
  let fixture: ComponentFixture<HostingAccounts>;
  let internals: Internals;
  let forge: FakeForge;
  let installedPlugins: WritableSignal<readonly PluginSummary[]>;

  /**
   * Creates the component and lets its first read finish.
   */
  async function open(): Promise<void> {
    fixture = TestBed.createComponent(HostingAccounts);
    internals = fixture.componentInstance as unknown as Internals;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Gets the only row.
   * @returns Returns it.
   */
  function row(): Row {
    return internals.rows()[0];
  }

  beforeEach(async () => {
    forge = new FakeForge();
    installedPlugins = signal<readonly PluginSummary[]>([]);
    await TestBed.configureTestingModule({
      imports: [HostingAccounts],
      providers: [
        { provide: Forge, useValue: forge },
        { provide: Plugins, useValue: { plugins: installedPlugins } },
      ],
    }).compileComponents();
  });

  it('listsEachHostThePluginsServe_withItsStatus', async () => {
    forge.listed = [account({ authenticated: true, detail: 'Signed in as matthew.' })];

    await open();

    expect(forge.hostsReads).toBe(1);
    expect(internals.rows().map((candidate: Row): string => candidate.account.host)).toEqual([
      'github.com',
    ]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('GitHub (github.com)');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Signed in as matthew.');
  });

  it('saysToInstallAPlugin_whenNoneServesAHost', async () => {
    // Core names no host: with no hosting plugin there is nothing to sign in to.
    forge.listed = [];

    await open();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No code-hosting plugin is installed',
    );
  });

  it('showsNothing_beforeTheFirstReadCompletes', () => {
    // Rendering "nothing installed" while the read is still in flight would be a lie the user acts on.
    fixture = TestBed.createComponent(HostingAccounts);
    internals = fixture.componentInstance as unknown as Internals;

    expect(internals.loaded()).toBe(false);
    expect(internals.rows()).toEqual([]);
  });

  it('offersAutomatic_thenEachModeThePluginDeclares', async () => {
    await open();

    expect(
      internals.options(row()).map((option: { value: string }): string => option.value),
    ).toEqual(['automatic', 'cli', 'studio']);
    expect(internals.modeOf(row())).toBe('automatic');
  });

  it('choosingAMode_sendsIt_andNullForAutomatic', async () => {
    await open();
    forge.next = account({}, { authMode: 'cli' });

    await internals.onMode(row(), 'cli');
    expect(internals.modeOf(row())).toBe('cli');

    forge.next = account();
    await internals.onMode(row(), 'automatic');

    expect(forge.calls).toEqual([
      ['setAuthMode', 'onixlabs.github', 'github.com', 'cli'],
      ['setAuthMode', 'onixlabs.github', 'github.com', null],
    ]);
  });

  it('hidesTheToken_whenTheUserChoseTheCommandLineLogin', async () => {
    forge.listed = [account({}, { authMode: 'cli' })];

    await open();

    expect(internals.offersToken(row())).toBe(false);
  });

  it('hidesTheToken_whenThePluginTakesNone', async () => {
    forge.listed = [account({}, { authModes: ['cli'] })];

    await open();

    expect(internals.offersToken(row())).toBe(false);
  });

  it('cannotSave_untilSomethingIsTyped', async () => {
    await open();

    expect(internals.canSave(row())).toBe(false);
    internals.onDraft(row(), '   ');
    expect(internals.canSave(row())).toBe(false);
    internals.onDraft(row(), 'ghp_token');
    expect(internals.canSave(row())).toBe(true);
  });

  it('save_sendsTheTokenForTheHost_andClearsTheField', async () => {
    // Leaving a token sitting in a form field after it has been stored serves no purpose.
    await open();
    forge.next = account({ authenticated: true, mode: 'studio', hasStoredToken: true });
    internals.onDraft(row(), 'ghp_token');

    await internals.onSave(row());

    expect(forge.calls).toEqual([['setToken', 'onixlabs.github', 'github.com', 'ghp_token']]);
    expect(row().draft).toBe('');
    expect(row().account.status.authenticated).toBe(true);
  });

  it('cannotClear_withoutAStoredToken', async () => {
    // A command-line login is not clearable from here — that is the tool's own business.
    forge.listed = [account({ authenticated: true, mode: 'cli', hasStoredToken: false })];

    await open();

    expect(internals.canClear(row())).toBe(false);
  });

  it('clear_removesTheStoredToken_andShowsWhatIsLeft', async () => {
    forge.listed = [account({ authenticated: true, mode: 'studio', hasStoredToken: true })];
    await open();
    expect(internals.canClear(row())).toBe(true);

    // Clearing leaves the command-line login in force, which the resulting status reports.
    forge.next = account({ authenticated: true, mode: 'cli', hasStoredToken: false });
    await internals.onClear(row());

    expect(forge.calls).toEqual([['clearToken', 'onixlabs.github', 'github.com']]);
    expect(row().account.status.mode).toBe('cli');
    expect(internals.canClear(row())).toBe(false);
  });

  it('readsEveryHostAgain_whenThePluginNoLongerServesOne', async () => {
    await open();
    forge.next = null;
    forge.listed = [];

    await internals.onMode(row(), 'cli');

    expect(forge.hostsReads).toBe(2);
    expect(internals.rows()).toEqual([]);
  });

  it('readsAgain_whenAHostingPluginIsInstalledWhileOpen', async () => {
    // The settings tab stays mounted, so an install from the Plugin Manager must reach it.
    forge.listed = [];
    await open();
    expect(internals.rows()).toEqual([]);

    forge.listed = [account()];
    installedPlugins.set([
      {
        id: 'onixlabs.github',
        name: 'GitHub',
        description: '',
        state: 'installed',
        version: '0.1.0',
        contributions: [{ slot: 'hosting', id: 'onixlabs.github' }],
      } as unknown as PluginSummary,
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(forge.hostsReads).toBe(2);
    expect(internals.rows().map((candidate: Row): string => candidate.account.host)).toEqual([
      'github.com',
    ]);
  });

  it('recheck_readsTheHostsAgain', async () => {
    await open();

    await internals.refresh();

    expect(forge.hostsReads).toBe(2);
  });
});
