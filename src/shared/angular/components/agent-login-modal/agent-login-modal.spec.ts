import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AiSignInProgress, AiSignInRequest } from '@shared/api/ai-types';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Shell } from '@shared/angular/services/shell/shell';
import { AgentLoginModal } from './agent-login-modal';

/**
 * Stands in for the runtime, reporting whatever sign-in progress a test gives it.
 */
class FakeRuntime {
  public report: (progress: AiSignInProgress) => void = (): void => undefined;
  public starts: number = 0;

  public onSignInProgress(listener: (progress: AiSignInProgress) => void): () => void {
    this.report = listener;
    return (): void => undefined;
  }

  public startSignIn(): void {
    this.starts += 1;
  }

  public cancelSignIn(): void {
    return undefined;
  }
}

/**
 * Hosts the modal open, as a conversation does when its sign-in has lapsed.
 */
@Component({
  imports: [AgentLoginModal],
  template: `<app-agent-login-modal [open]="open()" providerName="Claude" [request]="request" />`,
})
class LoginHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(true);
  public readonly request: AiSignInRequest | null = {} as AiSignInRequest;
}

describe('AgentLoginModal', () => {
  let fixture: ComponentFixture<LoginHost>;
  let runtime: FakeRuntime;
  let windows: FakeModalWindows;

  /**
   * Gets the text of the modal.
   * @returns Returns the text.
   */
  function text(): string {
    return windows.contentHost?.textContent ?? '';
  }

  /**
   * Presses the modal's primary button.
   */
  async function pressPrimary(): Promise<void> {
    windows.contentHost?.querySelector<HTMLButtonElement>('app-button-row button')?.click();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    runtime = new FakeRuntime();
    windows = new FakeModalWindows();
    TestBed.configureTestingModule({
      imports: [LoginHost],
      providers: [
        { provide: AiRuntime, useValue: runtime },
        { provide: ModalWindows, useValue: windows },
        { provide: Shell, useValue: { openExternal: (): Promise<void> => Promise.resolve() } },
      ],
    });
    fixture = TestBed.createComponent(LoginHost);
    await fixture.whenStable();
  });

  it('saysTheUserIsNotSignedIn_andOffersToLogIn', () => {
    expect(text()).toContain("You're Not Signed In to Claude");
    expect(text()).toContain('Log In to Claude');
    expect(runtime.starts).toBe(0);
  });

  it('saysTheUserIsSignedIn_onceTheyAre', async () => {
    await pressPrimary();

    runtime.report({ phase: 'success' });
    await fixture.whenStable();

    expect(text()).toContain('Signed In to Claude');
    expect(text()).not.toContain("You're Not Signed In");
  });

  it('raisesAFailureInADangerAlert_andOffersToTryAgain', async () => {
    await pressPrimary();

    runtime.report({ phase: 'error', message: 'The browser was closed.' });
    await fixture.whenStable();

    const alert: Element | null | undefined = windows.contentHost?.querySelector('app-alert');
    expect(alert?.classList.contains('alert--danger')).toBe(true);
    expect(alert?.textContent).toContain("Sign-in didn't complete.");
    expect(text()).toContain('Try Again');
  });
});
