import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GitIdentity } from '@shared/api/setup-channels';
import { SetupProbes } from '@shared/angular/services/setup-probes/setup-probes';
import { SetupStepCommitIdentity } from './setup-step-commit-identity';

/**
 * Stands in for the probe client: the identity read answers only when the test says so, which is
 * what lets a case put the user's typing before it.
 */
class FakeProbes {
  /**
   * Gets whether probing is available, as in the desktop application.
   */
  public readonly isAvailable: boolean = true;

  /**
   * Holds the identities written, in order.
   */
  public readonly written: GitIdentity[] = [];

  /**
   * Holds the pending read's answer, once it has been asked.
   */
  private answer: ((identity: GitIdentity | null) => void) | undefined = undefined;

  /**
   * Reads the identity, answering when {@link answerWith} is called.
   * @returns Returns the identity.
   */
  public gitIdentity(): Promise<GitIdentity | null> {
    return new Promise<GitIdentity | null>(
      (resolve: (identity: GitIdentity | null) => void): void => {
        this.answer = resolve;
      },
    );
  }

  /**
   * Writes an identity.
   * @param identity The identity.
   * @returns Returns it, as git would hold it.
   */
  public setGitIdentity(identity: GitIdentity): Promise<GitIdentity | null> {
    this.written.push(identity);
    return Promise.resolve(identity);
  }

  /**
   * Answers the pending read.
   * @param identity What git holds.
   */
  public answerWith(identity: GitIdentity | null): void {
    this.answer?.(identity);
  }
}

describe('SetupStepCommitIdentity', () => {
  let fixture: ComponentFixture<SetupStepCommitIdentity>;
  let probes: FakeProbes;
  let host: HTMLElement;

  /**
   * Reads a field's value by its accessible name.
   * @param label The field's aria-label.
   * @returns Returns the input.
   */
  function field(label: string): HTMLInputElement {
    const input: HTMLInputElement | null = host.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    );
    if (input === null) {
      throw new Error(`No field labelled ${label}`);
    }
    return input;
  }

  /**
   * Types into a field, as a user does.
   * @param label The field's aria-label.
   * @param value What to type.
   */
  function type(label: string, value: string): void {
    const input: HTMLInputElement = field(label);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  /**
   * Lets the identity read settle and the view catch up.
   */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    probes = new FakeProbes();
    await TestBed.configureTestingModule({
      imports: [SetupStepCommitIdentity],
      providers: [{ provide: SetupProbes, useValue: probes }],
    }).compileComponents();
    fixture = TestBed.createComponent(SetupStepCommitIdentity);
    fixture.componentRef.setInput('systemName', 'Git');
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('load_whenGitHoldsAnIdentity_prefillsTheFields', async () => {
    probes.answerWith({ name: 'Ada Lovelace', email: 'ada@example.com' });
    await settle();

    expect(field('Commit name').value).toBe('Ada Lovelace');
    expect(field('Commit email').value).toBe('ada@example.com');
  });

  it('load_whenItAnswersAfterTheUserTyped_keepsWhatTheyTyped', async () => {
    // A first run: git holds no identity, and the read comes back after the user has started.
    type('Commit name', 'Grace Hopper');
    type('Commit email', 'grace@example.com');

    probes.answerWith({ name: '', email: '' });
    await settle();

    expect(field('Commit name').value).toBe('Grace Hopper');
    expect(field('Commit email').value).toBe('grace@example.com');
  });

  it('load_whenOnlyOneFieldWasTyped_fillsTheOther', async () => {
    type('Commit name', 'Grace Hopper');

    probes.answerWith({ name: 'Old Name', email: 'old@example.com' });
    await settle();

    expect(field('Commit name').value).toBe('Grace Hopper');
    expect(field('Commit email').value).toBe('old@example.com');
  });
});
