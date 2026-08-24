import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ForgeAuthStatus } from '@shared/api/forge-types';
import { Forge } from '@shared/angular/services/forge/forge';
import { SourceControlSettingsSection } from './source-control-settings';

/**
 * The protected surface of the section exercised by these tests.
 */
interface SectionInternals {
  status(): ForgeAuthStatus;
  draft(): string;
  canSave(): boolean;
  canClear(): boolean;
  onDraft(value: string): void;
  onSave(): Promise<void>;
  onClear(): Promise<void>;
  refresh(): Promise<void>;
}

/**
 * Builds a status.
 * @param overrides The fields to vary from the signed-out default.
 * @returns Returns the status.
 */
function status(overrides: Partial<ForgeAuthStatus> = {}): ForgeAuthStatus {
  return {
    source: 'none',
    authenticated: false,
    hasStoredToken: false,
    identity: null,
    detail: 'Not signed in to GitHub.',
    ...overrides,
  };
}

/**
 * A recording stand-in for the forge client. Note there is deliberately no way to read a token back
 * from it — that is the seam's whole point, and the fake keeps it honest.
 */
class FakeForge {
  public readonly isAvailable: boolean = true;

  /**
   * Holds the tokens passed to {@link setToken}, in order.
   */
  public readonly saved: string[] = [];

  /**
   * Holds how many times the token was cleared.
   */
  public cleared: number = 0;

  /**
   * Holds how many times the status was read.
   */
  public reads: number = 0;

  /**
   * Holds the status every call resolves to.
   */
  public next: ForgeAuthStatus = status();

  public authStatus(): Promise<ForgeAuthStatus> {
    this.reads += 1;
    return Promise.resolve(this.next);
  }

  public setToken(token: string): Promise<ForgeAuthStatus> {
    this.saved.push(token);
    return Promise.resolve(this.next);
  }

  public clearToken(): Promise<ForgeAuthStatus> {
    this.cleared += 1;
    return Promise.resolve(this.next);
  }
}

describe('SourceControlSettingsSection', () => {
  let fixture: ComponentFixture<SourceControlSettingsSection>;
  let internals: SectionInternals;
  let forge: FakeForge;

  beforeEach(async () => {
    forge = new FakeForge();
    await TestBed.configureTestingModule({
      imports: [SourceControlSettingsSection],
      providers: [{ provide: Forge, useValue: forge }],
    }).compileComponents();
    fixture = TestBed.createComponent(SourceControlSettingsSection);
    internals = fixture.componentInstance as unknown as SectionInternals;
  });

  it('readsTheStatusWhenThePageOpens', async () => {
    forge.next = status({ authenticated: true, source: 'stored', detail: 'Signed in as matthew.' });

    fixture.detectChanges();
    await fixture.whenStable();

    expect(forge.reads).toBe(1);
    expect(internals.status().detail).toBe('Signed in as matthew.');
  });

  it('cannotSave_untilSomethingIsTyped', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(internals.canSave()).toBe(false);

    internals.onDraft('   ');
    expect(internals.canSave()).toBe(false);

    internals.onDraft('ghp_token');
    expect(internals.canSave()).toBe(true);
  });

  it('save_sendsTheTokenAndClearsTheField', async () => {
    // Leaving a token sitting in a form field after it has been stored serves no purpose.
    fixture.detectChanges();
    await fixture.whenStable();
    forge.next = status({ authenticated: true, source: 'stored', hasStoredToken: true });
    internals.onDraft('ghp_token');

    await internals.onSave();

    expect(forge.saved).toEqual(['ghp_token']);
    expect(internals.draft()).toBe('');
    expect(internals.status().authenticated).toBe(true);
  });

  it('cannotClear_withoutAStoredToken', async () => {
    // A CLI login is not clearable from here — that is `gh auth logout`'s business.
    forge.next = status({ authenticated: true, source: 'gh-cli', hasStoredToken: false });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(internals.canClear()).toBe(false);
  });

  it('clear_removesTheStoredToken_andShowsWhatIsLeft', async () => {
    forge.next = status({ authenticated: true, source: 'stored', hasStoredToken: true });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(internals.canClear()).toBe(true);

    // Clearing leaves the CLI login in force, which the resulting status reports.
    forge.next = status({ authenticated: true, source: 'gh-cli', hasStoredToken: false });
    await internals.onClear();

    expect(forge.cleared).toBe(1);
    expect(internals.status().source).toBe('gh-cli');
    expect(internals.canClear()).toBe(false);
  });

  it('recheck_readsTheStatusAgain', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    await internals.refresh();

    expect(forge.reads).toBe(2);
  });

  it('showsAPendingDetail_beforeTheFirstReadCompletes', () => {
    // Rendering "not signed in" while the probe is still in flight would be a lie the user acts on.
    expect(internals.status().detail).toBe('Checking…');
    expect(internals.status().authenticated).toBe(false);
  });
});
