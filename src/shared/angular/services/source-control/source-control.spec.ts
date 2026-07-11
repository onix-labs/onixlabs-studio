import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import {
  GitRunResult,
  RepositoryInfo,
  SourceControlChannel,
} from '@shared/api/source-control-channels';
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

  it('openRepository_whenInvoked_forwardsAndReturnsTheRepository', async () => {
    const info: RepositoryInfo = { root: '/repos/studio', name: 'studio' };
    stubBridge(info);
    const service: SourceControl = TestBed.inject(SourceControl);

    const result: RepositoryInfo | null | undefined = await service.client?.openRepository();

    expect(calls).toEqual([{ channel: SourceControlChannel.OpenRepository, args: [] }]);
    expect(result).toEqual(info);
  });

  it('readOperations_whenInvoked_forwardTheirArguments', async () => {
    stubBridge({ success: true, stdout: '' });
    const service: SourceControl = TestBed.inject(SourceControl);

    await service.client?.status('/r');
    await service.client?.log('/r', 250);
    await service.client?.readBlob('/r', 'HEAD', 'src/app.ts');

    expect(calls).toEqual([
      { channel: SourceControlChannel.Status, args: ['/r'] },
      { channel: SourceControlChannel.Log, args: ['/r', 250] },
      { channel: SourceControlChannel.ReadBlob, args: ['/r', 'HEAD', 'src/app.ts'] },
    ]);
  });

  it('mutations_whenInvoked_forwardTheirArguments', async () => {
    stubBridge({ success: true });
    const service: SourceControl = TestBed.inject(SourceControl);

    await service.client?.stage('/r', ['a.ts', 'b.ts']);
    await service.client?.commit('/r', 'feat: message');
    await service.client?.push('/r', 'origin', 'main');

    expect(calls).toEqual([
      { channel: SourceControlChannel.Stage, args: ['/r', ['a.ts', 'b.ts']] },
      { channel: SourceControlChannel.Commit, args: ['/r', 'feat: message'] },
      { channel: SourceControlChannel.Push, args: ['/r', 'origin', 'main'] },
    ]);
  });

  it('operations_whenTheBridgeResolves_passTheResultThroughUnchanged', async () => {
    const outcome: GitRunResult = { success: false, error: 'not a repository' };
    stubBridge(outcome);
    const service: SourceControl = TestBed.inject(SourceControl);

    await expect(service.client?.fetch('/r')).resolves.toEqual(outcome);
  });
});
