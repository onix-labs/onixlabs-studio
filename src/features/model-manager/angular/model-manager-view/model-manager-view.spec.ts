import { afterEach, describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import {
  LocalModel,
  ModelRuntimeStatus,
  RunningModel,
  RuntimeInstallation,
} from '@shared/api/model-runtime-types';
import { ModelManagerView } from './model-manager-view';

/**
 * A recorded bridge invocation.
 */
interface RecordedCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

/**
 * One installed model the runtime reports.
 */
const INSTALLED: LocalModel = {
  name: 'qwen2.5-coder:7b',
  size: 4_700_000_000,
  digest: 'abc123',
  modifiedAt: '2026-08-01T10:00:00Z',
  family: 'qwen2',
  parameterSize: '7.6B',
  quantization: 'Q4_K_M',
};

/**
 * One model loaded into memory, running wholly on the CPU.
 */
const LOADED: RunningModel = {
  name: 'qwen2.5-coder:7b',
  size: 4_700_000_000,
  sizeVram: 0,
  expiresAt: '2026-08-19T12:05:00Z',
};

describe('ModelManagerView', () => {
  let calls: RecordedCall[];

  /**
   * Installs a recording stub bridge answering the runtime channels with fixed replies.
   * @param status The runtime status to report.
   * @param installation The installation to report.
   */
  function stubBridge(status: ModelRuntimeStatus, installation: RuntimeInstallation): void {
    calls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push({ channel, args });
        switch (channel as ModelRuntimeChannel) {
          case ModelRuntimeChannel.Status:
            return Promise.resolve(status as T);
          case ModelRuntimeChannel.Installation:
            return Promise.resolve(installation as T);
          case ModelRuntimeChannel.List:
            return Promise.resolve([INSTALLED] as T);
          case ModelRuntimeChannel.Running:
            return Promise.resolve([LOADED] as T);
          case ModelRuntimeChannel.DiskUsage:
            return Promise.resolve({ bytes: 4_700_000_000, path: '/models' } as T);
          default:
            return Promise.resolve(true as T);
        }
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  /**
   * Creates the view with its inputs set and its first load settled.
   * @returns Returns the component fixture.
   */
  async function createView(): Promise<ComponentFixture<ModelManagerView>> {
    const fixture: ComponentFixture<ModelManagerView> = TestBed.createComponent(ModelManagerView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Counts the invocations of a channel.
   */
  function countOf(channel: ModelRuntimeChannel): number {
    return calls.filter(
      (call: RecordedCall): boolean => (call.channel as ModelRuntimeChannel) === channel,
    ).length;
  }

  afterEach((): void => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  it('offers to install the runtime when no binary is present', async () => {
    stubBridge({ available: false }, { kind: 'absent', executable: '', version: '' });

    const fixture: ComponentFixture<ModelManagerView> = await createView();

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("Ollama isn't installed");
    expect(text).toContain('Install Ollama');
    expect(text).not.toContain('Start');
  });

  it('offers to start the server when the runtime is installed but stopped', async () => {
    stubBridge(
      { available: false },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );

    const fixture: ComponentFixture<ModelManagerView> = await createView();

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("Ollama isn't running");
    expect(text).toContain('Installed on this machine');
    expect(text).toContain('0.32.14');
    expect(text).not.toContain('Install Ollama');
  });

  it('lists the installed and loaded models once the server is running', async () => {
    stubBridge(
      { available: true, version: '0.32.14', startedByStudio: true },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );

    const fixture: ComponentFixture<ModelManagerView> = await createView();

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('qwen2.5-coder:7b');
    expect(text).toContain('7.6B');
    expect(text).toContain('Q4_K_M');
    expect(text).toContain('4.4 GB');
    // A model with nothing in VRAM is running on the CPU, which the view names rather than implying.
    expect(text).toContain('CPU');
  });

  it('marks the runtime as Studio-managed when Studio installed it', async () => {
    stubBridge(
      { available: false },
      { kind: 'managed', executable: '/userData/ollama', version: '0.32.14' },
    );

    const fixture: ComponentFixture<ModelManagerView> = await createView();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Managed by Studio');
  });

  it('reports the model store disk usage', async () => {
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );

    const fixture: ComponentFixture<ModelManagerView> = await createView();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('4.4 GB on disk');
  });

  it('starts the server through the runtime client', async () => {
    stubBridge(
      { available: false },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );
    const fixture: ComponentFixture<ModelManagerView> = await createView();

    const start: HTMLButtonElement | null = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ].find((button: Element): boolean =>
      (button.textContent ?? '').includes('Start'),
    ) as HTMLButtonElement | null;
    start?.click();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    expect(countOf(ModelRuntimeChannel.Start)).toBe(1);
  });

  it('removes a model through the runtime client', async () => {
    stubBridge(
      { available: true, version: '0.32.14', startedByStudio: true },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );
    const fixture: ComponentFixture<ModelManagerView> = await createView();

    const remove: HTMLButtonElement | null = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('[aria-label="Remove"]');
    remove?.click();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    const call: RecordedCall | undefined = calls.find(
      (recorded: RecordedCall): boolean =>
        (recorded.channel as ModelRuntimeChannel) === ModelRuntimeChannel.Remove,
    );
    expect(call?.args).toEqual(['qwen2.5-coder:7b']);
  });
});
