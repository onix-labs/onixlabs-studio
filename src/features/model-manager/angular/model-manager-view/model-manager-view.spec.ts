import { afterEach, describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import { CatalogResult } from '@shared/api/model-catalog-types';
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

/**
 * A curated catalogue entry and a Hugging Face one, so both badges and both size behaviours are shown.
 */
const CATALOG: CatalogResult = {
  models: [
    {
      ref: 'llama3.2:3b',
      name: 'Llama 3.2 3B',
      source: 'curated',
      category: 'general',
      description: 'A compact general-purpose model.',
      parameterSize: '3.2B',
      sizeBytes: 2_019_392_628,
      downloads: 0,
      url: 'https://ollama.com/library/llama3.2',
    },
    {
      ref: 'hf.co/bartowski/Some-Model-GGUF',
      name: 'bartowski/Some-Model-GGUF',
      source: 'huggingface',
      category: 'other',
      description: '',
      parameterSize: '7B',
      sizeBytes: 0,
      downloads: 999,
      url: 'https://huggingface.co/bartowski/Some-Model-GGUF',
    },
  ],
  failedSources: [],
};

describe('ModelManagerView', () => {
  let calls: RecordedCall[];
  let catalogResult: CatalogResult = CATALOG;

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
          case ModelRuntimeChannel.Describe:
            return Promise.resolve({ id: 'ollama', displayName: 'Ollama' } as T);
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
          case ModelRuntimeChannel.SearchCatalog:
            return Promise.resolve(catalogResult as T);
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
    catalogResult = CATALOG;
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

  it('names the runtime from the backend rather than assuming Ollama', async () => {
    stubBridge(
      { available: false },
      { kind: 'system', executable: '/opt/llama/server', version: '1.0.0' },
    );
    // Swap in a different runtime identity: the view must follow it, since the slot is not Ollama-only.
    const original: Bridge = (window as unknown as { bridge: Bridge }).bridge;
    (window as unknown as { bridge: Bridge }).bridge = {
      ...original,
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> =>
        (channel as ModelRuntimeChannel) === ModelRuntimeChannel.Describe
          ? Promise.resolve({ id: 'llamacpp', displayName: 'llama.cpp' } as T)
          : original.invoke<T>(channel, ...args),
    };

    const fixture: ComponentFixture<ModelManagerView> = await createView();

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("llama.cpp isn't running");
    expect(text).not.toContain('Ollama');
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

  it('lists the catalogue with its source badges once the server is running', async () => {
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );

    const fixture: ComponentFixture<ModelManagerView> = await createView();

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Available');
    expect(text).toContain('Llama 3.2 3B');
    expect(text).toContain('A compact general-purpose model.');
    expect(text).toContain('Ollama');
    expect(text).toContain('Hugging Face');
  });

  it('shows a dash for a catalogue entry with no known size', async () => {
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );

    const fixture: ComponentFixture<ModelManagerView> = await createView();

    // The Hugging Face entry's size depends on the quantisation Ollama picks, so it is unknown here.
    const rows: HTMLElement[] = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'),
    ] as HTMLElement[];
    const hub: HTMLElement | undefined = rows.find((row: HTMLElement): boolean =>
      (row.textContent ?? '').includes('Some-Model-GGUF'),
    );
    expect(hub?.textContent).toContain('—');
  });

  it('marks an already-installed catalogue model rather than offering to install it', async () => {
    catalogResult = {
      models: [
        {
          ref: 'qwen2.5-coder:7b',
          name: 'Qwen 2.5 Coder 7B',
          source: 'curated',
          category: 'coding',
          description: '',
          parameterSize: '7.6B',
          sizeBytes: 1,
          downloads: 0,
          url: '',
        },
      ],
      failedSources: [],
    };
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );

    const fixture: ComponentFixture<ModelManagerView> = await createView();

    // INSTALLED is qwen2.5-coder:7b, so the catalogue row for it must not offer an Install button.
    const rows: HTMLElement[] = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'),
    ] as HTMLElement[];
    const row: HTMLElement | undefined = rows.find((r: HTMLElement): boolean =>
      (r.textContent ?? '').includes('Qwen 2.5 Coder 7B'),
    );
    expect(row?.textContent).toContain('Installed');
  });

  it('warns when a catalogue source failed, rather than silently showing fewer results', async () => {
    catalogResult = { models: CATALOG.models, failedSources: ['huggingface'] };
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );

    const fixture: ComponentFixture<ModelManagerView> = await createView();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Partial results');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('huggingface');
  });

  it('pulls a catalogue model through the runtime client', async () => {
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );
    const fixture: ComponentFixture<ModelManagerView> = await createView();

    const install: HTMLButtonElement | undefined = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ].find((button: HTMLButtonElement): boolean => (button.textContent ?? '').includes('Install'));
    install?.click();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    const call: RecordedCall | undefined = calls.find(
      (recorded: RecordedCall): boolean =>
        (recorded.channel as ModelRuntimeChannel) === ModelRuntimeChannel.Pull,
    );
    expect(call?.args).toEqual(['llama3.2:3b']);
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
