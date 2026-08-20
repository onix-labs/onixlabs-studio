import { TestBed } from '@angular/core/testing';
import { ApiEnvironment, ApiFolder, HttpField, HttpOutcome } from '@shared/api/api-client-types';
import { ApiHttp } from '../api-http/api-http';
import { ApiWorkspace } from '../api-workspace/api-workspace';
import { ApiPrompts } from './api-prompts';

/**
 * A stand-in engine, so nothing here reaches a socket.
 */
class FakeHttp {
  /**
   * Never called by these tests.
   * @returns Returns a stubbed outcome.
   */
  public send(): Promise<HttpOutcome> {
    return Promise.resolve({} as HttpOutcome);
  }

  /**
   * Never called by these tests.
   */
  public cancel(): void {
    // Intentionally empty.
  }
}

describe('ApiPrompts', () => {
  let prompts: ApiPrompts;
  let workspace: ApiWorkspace;

  beforeEach(() => {
    globalThis.localStorage?.clear();
    TestBed.configureTestingModule({
      providers: [ApiWorkspace, ApiPrompts, { provide: ApiHttp, useClass: FakeHttp }],
    });
    workspace = TestBed.inject(ApiWorkspace);
    prompts = TestBed.inject(ApiPrompts);
  });

  it('promptCollection_opensOnABlankField_evenAfterAnEarlierName', () => {
    prompts.promptCollection();
    prompts.collectionName.set('Typed and abandoned');
    prompts.cancelCollection();

    prompts.promptCollection();

    expect(prompts.collectionOpen()).toBe(true);
    expect(prompts.collectionName()).toBe('');
  });

  it('confirmCollection_addsTheNamedCollectionAndCloses', () => {
    prompts.promptCollection();
    prompts.collectionName.set('  Orders  ');

    const created: ApiFolder | null = prompts.confirmCollection();

    expect(created?.name).toBe('Orders');
    expect(prompts.collectionOpen()).toBe(false);
    expect(workspace.folders().some((folder: ApiFolder): boolean => folder.name === 'Orders')).toBe(
      true,
    );
  });

  it('confirmCollection_withAnEmptyName_addsNothingAndStaysOpen', () => {
    prompts.promptCollection();
    const before: number = workspace.folders().length;

    expect(prompts.confirmCollection()).toBeNull();

    expect(workspace.folders()).toHaveLength(before);
    expect(prompts.collectionOpen()).toBe(true);
  });

  it('confirmEnvironment_storesTheRootAddressAsBaseUrl', () => {
    prompts.promptEnvironment();
    prompts.environmentName.set('Local');
    prompts.environmentRootUrl.set('http://localhost:8080');

    const created: ApiEnvironment | null = prompts.confirmEnvironment();

    // Requests are written against {{base_url}}, so a new environment with an address is usable by
    // every request that already exists.
    expect(created?.variables.map((variable: HttpField): string => variable.name)).toEqual([
      'base_url',
    ]);
    expect(created?.variables[0].value).toBe('http://localhost:8080');
  });

  it('confirmEnvironment_withNoRootAddress_addsItWithNoVariables', () => {
    prompts.promptEnvironment();
    prompts.environmentName.set('Empty');

    expect(prompts.confirmEnvironment()?.variables).toEqual([]);
  });

  it('cancelEnvironment_addsNothing', () => {
    prompts.promptEnvironment();
    prompts.environmentName.set('Discarded');
    const before: number = workspace.environments().length;

    prompts.cancelEnvironment();

    expect(prompts.environmentOpen()).toBe(false);
    expect(workspace.environments()).toHaveLength(before);
  });
});
