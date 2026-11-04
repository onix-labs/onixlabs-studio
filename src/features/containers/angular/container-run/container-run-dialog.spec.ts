import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RunContainerRequest } from '@shared/api/container-types';
import { Settings } from '@shared/angular/services/settings/settings';
import { ContainersClient } from '../client/containers-client';
import { ContainerRunDialog } from './container-run-dialog';

/**
 * What the dialog exposes to its template, for driving it here.
 */
interface DialogInternals {
  readonly image: { set(value: string): void };
  readonly pendingPull: () => RunContainerRequest | null;
  readonly problems: () => readonly string[];
  run(): Promise<void>;
  pullThenRun(): Promise<void>;
}

/**
 * Stands in for the engine client: the image is missing until it has been pulled.
 */
class FakeClient {
  public pulled: string[] = [];

  /**
   * Answers a run.
   * @returns Returns the new container, or that the image is missing.
   */
  public run(): Promise<{ id?: string; error?: string; missingImage?: boolean }> {
    return Promise.resolve(
      this.pulled.length > 0
        ? { id: 'new' }
        : { error: 'There is no image on this machine.', missingImage: true },
    );
  }

  /**
   * Records a pull.
   * @param reference The image.
   * @returns Returns a success.
   */
  public pullImage(reference: string): Promise<{ ok: boolean }> {
    this.pulled.push(reference);
    return Promise.resolve({ ok: true });
  }
}

describe('ContainerRunDialog', () => {
  let fixture: ComponentFixture<ContainerRunDialog>;
  let dialog: DialogInternals;
  let client: FakeClient;
  let closed: (string | null)[];

  beforeEach(() => {
    localStorage.removeItem('settings');
    client = new FakeClient();
    TestBed.configureTestingModule({
      imports: [ContainerRunDialog],
      providers: [{ provide: ContainersClient, useValue: client }],
    });
    fixture = TestBed.createComponent(ContainerRunDialog);
    dialog = fixture.componentInstance as unknown as DialogInternals;
    closed = [];
    fixture.componentInstance.closed.subscribe((id: string | null): void => {
      closed.push(id);
    });
    dialog.image.set('postgres:16');
  });

  afterEach(() => {
    localStorage.removeItem('settings');
  });

  it('ask_offersThePull_andRunsOnceTheUserSaysSo', async () => {
    await dialog.run();
    expect(dialog.pendingPull()?.image).toBe('postgres:16');
    expect(client.pulled).toEqual([]);

    await dialog.pullThenRun();

    expect(client.pulled).toEqual(['postgres:16']);
    expect(closed).toEqual(['new']);
  });

  it('automatic_pullsAndRuns', async () => {
    TestBed.inject(Settings).set('containers.pullMissing', 'automatic');

    await dialog.run();

    expect(client.pulled).toEqual(['postgres:16']);
    expect(closed).toEqual(['new']);
  });

  it('never_saysWhyAndPullsNothing', async () => {
    TestBed.inject(Settings).set('containers.pullMissing', 'never');

    await dialog.run();

    expect(dialog.pendingPull()).toBeNull();
    expect(client.pulled).toEqual([]);
    expect(dialog.problems()).toEqual(['There is no image on this machine.']);
  });
});
