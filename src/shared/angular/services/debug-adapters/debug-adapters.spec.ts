import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { DebugAdapterSummary, DebugChannel } from '@shared/api/debug-channels';
import { DebugAdapters } from './debug-adapters';

/**
 * The registered adapters the fake main process publishes: C# is debugged by two implementations, so
 * it is a slot the user chooses for, while Node is debugged by one.
 */
const CATALOGUE: readonly DebugAdapterSummary[] = [
  { id: 'netcoredbg', displayName: '.NET (netcoredbg)', languages: ['csharp'], priority: 100 },
  { id: 'vsdbg-alt', displayName: 'Alternative .NET', languages: ['csharp'], priority: 50 },
  {
    id: 'js-debug',
    displayName: 'Node (js-debug)',
    languages: ['typescript', 'javascript'],
    priority: 100,
  },
];

describe('DebugAdapters', () => {
  let catalogue: readonly DebugAdapterSummary[];

  beforeEach(() => {
    catalogue = CATALOGUE;
    localStorage.clear();
    const bridge: Bridge = {
      invoke: <T>(channel: string): Promise<T> =>
        channel === (DebugChannel.GetCatalogue as string)
          ? Promise.resolve(catalogue as T)
          : Promise.resolve(null as T),
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    localStorage.clear();
  });

  it('resolveAdapter_noChoice_keepsTheDeclaredAdapter', async () => {
    const service: DebugAdapters = TestBed.inject(DebugAdapters);
    await service.ready;

    expect(service.resolveAdapter('netcoredbg')).toBe('netcoredbg');
  });

  it('resolveAdapter_chosen_overridesTheProjectSystemsDeclaredAdapter', async () => {
    const service: DebugAdapters = TestBed.inject(DebugAdapters);
    await service.ready;
    service.setAdapterForLanguage('csharp', 'vsdbg-alt');

    expect(service.resolveAdapter('netcoredbg')).toBe('vsdbg-alt');
  });

  it('resolveAdapter_choiceForAnotherLanguage_isIgnored', async () => {
    const service: DebugAdapters = TestBed.inject(DebugAdapters);
    await service.ready;
    service.setAdapterForLanguage('csharp', 'vsdbg-alt');

    expect(service.resolveAdapter('js-debug')).toBe('js-debug');
  });

  it('resolveAdapter_unknownDeclaredAdapter_isPassedThroughUnchanged', async () => {
    const service: DebugAdapters = TestBed.inject(DebugAdapters);
    await service.ready;

    expect(service.resolveAdapter('not-registered')).toBe('not-registered');
  });

  it('resolveAdapter_beforeTheCatalogueLoads_keepsTheDeclaredAdapter', () => {
    // Debugging must never break because the catalogue has not arrived yet: with nothing registered,
    // the project system's declared adapter stands.
    const service: DebugAdapters = TestBed.inject(DebugAdapters);

    expect(service.resolveAdapter('netcoredbg')).toBe('netcoredbg');
  });

  it('adaptersForLanguage_reportsEveryImplementationOfferedForTheSlot', async () => {
    const service: DebugAdapters = TestBed.inject(DebugAdapters);
    await service.ready;

    expect(
      service.adaptersForLanguage('csharp').map((a: DebugAdapterSummary): string => a.id),
    ).toEqual(['netcoredbg', 'vsdbg-alt']);
  });

  it('setAdapterForLanguage_null_clearsTheChoiceAndRestoresTheDefault', async () => {
    const service: DebugAdapters = TestBed.inject(DebugAdapters);
    await service.ready;
    service.setAdapterForLanguage('csharp', 'vsdbg-alt');
    service.setAdapterForLanguage('csharp', null);

    expect(service.resolveAdapter('netcoredbg')).toBe('netcoredbg');
  });

  it('setAdapterForLanguage_persistsTheChoiceAcrossInstances', async () => {
    const first: DebugAdapters = TestBed.inject(DebugAdapters);
    await first.ready;
    first.setAdapterForLanguage('csharp', 'vsdbg-alt');

    TestBed.resetTestingModule();
    const second: DebugAdapters = TestBed.inject(DebugAdapters);
    await second.ready;

    expect(second.resolveAdapter('netcoredbg')).toBe('vsdbg-alt');
  });

  it('resolveAdapter_contributedAdapter_isSelectableWithoutCodeChange', async () => {
    catalogue = [
      ...CATALOGUE,
      { id: 'contributed', displayName: 'Contributed', languages: ['csharp'], priority: 10 },
    ];
    const service: DebugAdapters = TestBed.inject(DebugAdapters);
    await service.ready;
    service.setAdapterForLanguage('csharp', 'contributed');

    expect(service.resolveAdapter('netcoredbg')).toBe('contributed');
  });
});
