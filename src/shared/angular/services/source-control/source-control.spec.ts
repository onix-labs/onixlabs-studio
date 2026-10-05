import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { RepositoryInfo, SourceControlChannel } from '@shared/api/source-control-channels';
import { VersionControlResponse } from '@shared/api/version-control-protocol';
import { SourceControl } from './source-control';

/**
 * A recorded bridge invocation.
 */
interface RecordedCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

describe('SourceControl', () => {
  let calls: RecordedCall[];

  /**
   * Installs a stub bridge on the window that records invocations and resolves with a fixed result.
   * @param result The value every stubbed invoke resolves with.
   */
  function stubBridge(result: unknown): void {
    calls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        return Promise.resolve(result as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('client_whenBridgeAbsent_isUndefined', () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const service: SourceControl = TestBed.inject(SourceControl);

    expect(service.client).toBeUndefined();
  });

  it('resolveRepository_forwardsTheFolderAndReturnsTheRepository', async () => {
    const info: RepositoryInfo = { root: '/repos/studio', name: 'studio' };
    stubBridge(info);
    const service: SourceControl = TestBed.inject(SourceControl);

    const result: RepositoryInfo | null | undefined =
      await service.client?.resolveRepository('/repos/studio/src');

    expect(calls).toEqual([
      { channel: SourceControlChannel.ResolveRepository, args: ['/repos/studio/src'] },
    ]);
    expect(result).toEqual(info);
  });

  it('closeRepository_forwardsTheRoot', async () => {
    stubBridge(undefined);
    const service: SourceControl = TestBed.inject(SourceControl);

    await service.client?.closeRepository('/repos/studio');

    expect(calls).toEqual([
      { channel: SourceControlChannel.CloseRepository, args: ['/repos/studio'] },
    ]);
  });

  it('request_forwardsTheRootOperationAndParameters', async () => {
    const answer: VersionControlResponse<'log'> = { id: 0, ok: true, result: [] };
    stubBridge(answer);
    const service: SourceControl = TestBed.inject(SourceControl);

    const result: VersionControlResponse<'log'> | undefined = await service.client?.request(
      '/repos/studio',
      'log',
      { limit: 10 },
    );

    expect(calls).toEqual([
      { channel: SourceControlChannel.Request, args: ['/repos/studio', 'log', { limit: 10 }] },
    ]);
    expect(result).toEqual(answer);
  });
});
