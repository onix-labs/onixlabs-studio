import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: (): string => tmpdir() },
}));

const { DebugAdapterRegistry } = await import('./debug-adapter-registry');
const { DebugAdapterLocator } = await import('./debug-adapter-locator');
type Entry = import('./debug-adapter-registry').DebugAdapterCatalogueEntry;
type Resolution = import('./debug-adapter-registry').DebugAdapterResolution;

/**
 * A locator with an answer ready.
 */
class FixedLocator extends DebugAdapterLocator {
  public constructor(private readonly found: string | null) {
    super();
  }

  public override locate(): Promise<string | null> {
    return Promise.resolve(this.found);
  }
}

/**
 * Builds a catalogue entry.
 * @param overrides What differs from the default.
 * @returns Returns the entry.
 */
function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'fake',
    displayName: 'Fake',
    binary: 'fake-dbg',
    languages: ['fake'],
    priority: 1,
    buildSpec: (binaryPath: string): Resolution => ({
      spec: { command: binaryPath, args: [] },
      error: null,
    }),
    ...overrides,
  };
}

describe('DebugAdapterRegistry', () => {
  it('resolvesAnUnknownAdapter_withNoSpecAndNoReason', async () => {
    const registry: InstanceType<typeof DebugAdapterRegistry> = new DebugAdapterRegistry(
      new FixedLocator('/bin/x'),
    );

    expect(await registry.resolve('nope', '/root')).toEqual({ spec: null, error: null });
    expect(registry.has('nope')).toBe(false);
  });

  it('saysHowToFixAnAdapterThatIsNotInstalled', async () => {
    const registry: InstanceType<typeof DebugAdapterRegistry> = new DebugAdapterRegistry(
      new FixedLocator(null),
    );
    registry.register(entry());

    const resolution: Resolution = await registry.resolve('fake', '/root');

    expect(resolution.spec).toBeNull();
    expect(resolution.error).toMatch(/not installed.*Plugins/);
  });

  it('prefersWhereThePluginInstalledIt_overThePath', async () => {
    const registry: InstanceType<typeof DebugAdapterRegistry> = new DebugAdapterRegistry(
      new FixedLocator('/on/path'),
    );
    registry.register(
      entry({ locate: (): Promise<string | null> => Promise.resolve('/in/plugin') }),
    );

    expect((await registry.resolve('fake', '/root')).spec?.command).toBe('/in/plugin');
  });

  it('fallsBackToThePath_whenThePluginHasNotInstalledIt', async () => {
    const registry: InstanceType<typeof DebugAdapterRegistry> = new DebugAdapterRegistry(
      new FixedLocator('/on/path'),
    );
    registry.register(entry({ locate: (): Promise<string | null> => Promise.resolve(null) }));

    expect((await registry.resolve('fake', '/root')).spec?.command).toBe('/on/path');
  });

  it('passesOnAnAdapterThatIsThereButCannotRun', async () => {
    const registry: InstanceType<typeof DebugAdapterRegistry> = new DebugAdapterRegistry(
      new FixedLocator('/on/path'),
    );
    registry.register(
      entry({
        buildSpec: (): Resolution => ({ spec: null, error: 'No Python interpreter was found' }),
      }),
    );

    expect((await registry.resolve('fake', '/root')).error).toBe('No Python interpreter was found');
  });

  it('replacesAnAdapterRegisteredTwice_andListsItOnce_withoutHowItIsBuilt', () => {
    const registry: InstanceType<typeof DebugAdapterRegistry> = new DebugAdapterRegistry(
      new FixedLocator(null),
    );
    registry.register(entry());
    registry.register(entry({ displayName: 'Newer' }));

    expect(
      registry.catalogue().filter((summary: { id: string }): boolean => summary.id === 'fake'),
    ).toEqual([{ id: 'fake', displayName: 'Newer', languages: ['fake'], priority: 1 }]);
  });
});
