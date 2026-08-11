import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, Mock, vi } from 'vitest';
import { Ai } from '@shared/angular/services/ai/ai';
import { AiRemoteNotifications } from './ai-remote-notifications';

/**
 * Exposes the component's protected surface for assertions.
 */
interface Testable {
  enabled(): boolean;
  onChange(next: boolean): void;
}

/**
 * A fake AI client capturing the notification-preference calls.
 */
class FakeClient {
  public getRemoteNotifications: Mock = vi.fn().mockResolvedValue(true);
  public setRemoteNotifications: Mock = vi.fn().mockResolvedValue(undefined);
}

describe('AiRemoteNotifications', () => {
  let fixture: ComponentFixture<AiRemoteNotifications>;
  let view: Testable;
  let client: FakeClient;

  async function create(): Promise<void> {
    client = new FakeClient();
    await TestBed.configureTestingModule({
      imports: [AiRemoteNotifications],
      providers: [{ provide: Ai, useValue: { client } }],
    }).compileComponents();
    fixture = TestBed.createComponent(AiRemoteNotifications);
    view = fixture.componentInstance as unknown as Testable;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('load_seedsTheToggleFromThePersistedPreference', async () => {
    await create();
    expect(client.getRemoteNotifications).toHaveBeenCalledTimes(1);
    expect(view.enabled()).toBe(true);
  });

  it('onChange_persistsTheNewValueAndReflectsIt', async () => {
    await create();
    view.onChange(false);
    expect(client.setRemoteNotifications).toHaveBeenCalledWith(false);
    expect(view.enabled()).toBe(false);
  });
});
