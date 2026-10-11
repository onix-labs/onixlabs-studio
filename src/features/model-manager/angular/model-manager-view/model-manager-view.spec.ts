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
import {
  ModelGroupId,
  ModelManagerCommands,
} from '../model-manager-commands/model-manager-commands';
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
   * Opens a group of the list the way the ribbon does, and lets it render.
   * @param fixture The view.
   * @param group The group to open.
   */
  function openGroup(fixture: ComponentFixture<ModelManagerView>, group: ModelGroupId): void {
    TestBed.inject(ModelManagerCommands).openGroup(group);
    fixture.detectChanges();
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
    expect(text).toContain('Install it from the ribbon');
    // The ribbon offers Install in place of Start.
    expect(TestBed.inject(ModelManagerCommands).needsInstall()).toBe(true);
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
    expect(TestBed.inject(ModelManagerCommands).needsInstall()).toBe(false);
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

    openGroup(fixture, 'loaded');
    // A model with nothing in VRAM is running on the CPU, which the view names rather than implying.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('CPU');
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
    await createView();

    TestBed.inject(ModelManagerCommands).start();
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
    openGroup(fixture, 'available');

    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Available');
    expect(text).toContain('Llama 3.2 3B');
    expect(text).toContain('A compact general-purpose model.');
    const sources: string[] = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('td app-chip'),
    ].map((chip: HTMLElement): string => `${chip.textContent?.trim()} ${chip.className}`);
    // The curated source is the accent chip; a Hugging Face result is neutral.
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Ollama .*chip--accent/),
        expect.stringMatching(/^Hugging Face .*chip--neutral/),
      ]),
    );
  });

  it('shows a dash for a catalogue entry with no known size', async () => {
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );

    const fixture: ComponentFixture<ModelManagerView> = await createView();
    openGroup(fixture, 'available');

    // The Hugging Face entry's size depends on the quantisation Ollama picks, so it is unknown here.
    const rows: HTMLElement[] = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'),
    ] as HTMLElement[];
    const hub: HTMLElement | undefined = rows.find((row: HTMLElement): boolean =>
      (row.textContent ?? '').includes('Some-Model-GGUF'),
    );
    expect(hub?.textContent).toContain('—');
  });

  it('leaves an installed model out of the catalogue, as the Plugin Manager does', async () => {
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
    openGroup(fixture, 'available');

    // INSTALLED is qwen2.5-coder:7b, so the catalogue leaves it out, as an installed plugin is left
    // out of Available; with nothing else in the catalogue, the Available box goes too.
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Qwen 2.5 Coder 7B');
    expect(
      [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          'app-accordion .accordion__heading',
        ),
      ].map((heading: HTMLElement): string => heading.textContent?.trim() ?? ''),
    ).not.toContain('Available');
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
    openGroup(fixture, 'available');

    const install: HTMLButtonElement | undefined = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.model-manager__action button',
      ),
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

  it('describesAnInstalledModel_fromTheCatalogueEntryWithTheSameReference', async () => {
    catalogResult = {
      models: [
        {
          ref: 'qwen2.5-coder:7b',
          name: 'Qwen 2.5 Coder 7B',
          source: 'curated',
          category: 'coding',
          description: 'A strong coding model.',
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

    const row: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      'tr.table-row',
    );
    expect(row?.querySelector('.model-manager__description')?.textContent).toBe(
      'A strong coding model.',
    );
  });

  it('statesAndActions_matchThePluginManager', async () => {
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );
    const fixture: ComponentFixture<ModelManagerView> = await createView();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const cells: () => string[] = (): string[] =>
      [...host.querySelectorAll<HTMLElement>('tr.table-row')].map(
        (row: HTMLElement): string =>
          `${row.querySelector('app-chip.model-manager__state')?.textContent?.trim()} / ${row
            .querySelector('.model-manager__action button')
            ?.textContent?.trim()}`,
      );

    // An installed model is Installed, with Remove.
    expect(cells()).toEqual(['Installed / Remove']);

    openGroup(fixture, 'available');
    // The catalogue offers Install for what is not there yet.
    expect(cells()).toContain('Not installed / Install');
  });

  it('opensInstalledFirst_andOnlyOneGroupAtATime', async () => {
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );
    const fixture: ComponentFixture<ModelManagerView> = await createView();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const open: () => string[] = (): string[] =>
      [
        ...host.querySelectorAll<HTMLElement>('.model-manager__group--open .accordion__heading'),
      ].map((heading: HTMLElement): string => heading.textContent?.trim() ?? '');

    expect(
      [...host.querySelectorAll<HTMLElement>('app-accordion .accordion__heading')].map(
        (heading: HTMLElement): string => heading.textContent?.trim() ?? '',
      ),
    ).toEqual(['Installed', 'Available', 'Loaded']);
    expect(open()).toEqual(['Installed']);
    expect(host.querySelectorAll('app-table')).toHaveLength(1);
    expect(TestBed.inject(ModelManagerCommands).shownGroup()).toBe('installed');

    host.querySelectorAll<HTMLButtonElement>('.accordion__header')[2].click();
    fixture.detectChanges();
    expect(open()).toEqual(['Loaded']);
  });

  it('saysWhatIsInstalledAndLoaded_underTheHeading', async () => {
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );
    const fixture: ComponentFixture<ModelManagerView> = await createView();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.model-manager__headline')?.textContent,
    ).toContain('Ollama is running. 1 model installed, 1 loaded, 4.4 GB on disk.');
  });

  it('search_filtersTheInstalledModelsByName', async () => {
    stubBridge(
      { available: true, version: '0.32.14' },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );
    const fixture: ComponentFixture<ModelManagerView> = await createView();
    const commands: ModelManagerCommands = TestBed.inject(ModelManagerCommands);

    commands.search('QWEN');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('qwen2.5-coder:7b');
    expect(commands.searchText()).toBe('QWEN');

    commands.search('mistral');
    fixture.detectChanges();
    // Nothing installed matches, so the Installed box is left out.
    expect(
      [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          'app-accordion .accordion__heading',
        ),
      ].map((heading: HTMLElement): string => heading.textContent?.trim() ?? ''),
    ).not.toContain('Installed');
  });

  it('removes a model through the runtime client', async () => {
    stubBridge(
      { available: true, version: '0.32.14', startedByStudio: true },
      { kind: 'system', executable: '/usr/local/bin/ollama', version: '0.32.14' },
    );
    const fixture: ComponentFixture<ModelManagerView> = await createView();

    const remove: HTMLButtonElement | null = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('.model-manager__action button');
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
