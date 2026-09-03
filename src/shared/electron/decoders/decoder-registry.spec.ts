import { describe, expect, it } from 'vitest';
import { DecoderDescriptor, DecoderResolution, decoderUnavailable } from './decoder-descriptor';
import { DecoderRegistry } from './decoder-registry';

/**
 * Builds a decoder descriptor for the tests.
 * @param id The identifier.
 * @param formats The formats it decodes.
 * @param priority The priority, defaulting to 100.
 * @param resolution The resolution it returns, defaulting to unavailable.
 * @returns Returns the descriptor.
 */
function decoder(
  id: string,
  formats: readonly string[],
  priority: number = 100,
  resolution: DecoderResolution = decoderUnavailable('not installed'),
): DecoderDescriptor {
  return {
    id,
    displayName: id,
    formats,
    priority,
    resolve: (): DecoderResolution => resolution,
  };
}

describe('DecoderRegistry', (): void => {
  it('starts empty, because Studio ships no decoder of its own', (): void => {
    const registry: DecoderRegistry = new DecoderRegistry();
    expect(registry.all()).toEqual([]);
    // An empty registry is how "nothing installed" is expressed, including for native machine code.
    expect(registry.resolve('elf/x64')).toBeNull();
  });

  it('resolves a registered decoder for a format it claims', (): void => {
    const registry: DecoderRegistry = new DecoderRegistry();
    registry.register(decoder('native', ['elf/x64', 'macho/x64']));
    expect(registry.resolve('macho/x64')?.id).toBe('native');
  });

  it('resolves to null for a format nothing claims', (): void => {
    const registry: DecoderRegistry = new DecoderRegistry();
    registry.register(decoder('jvm', ['jvm']));
    expect(registry.resolve('wasm')).toBeNull();
  });

  it('lists every candidate for a format, so more than one can be offered as a choice', (): void => {
    const registry: DecoderRegistry = new DecoderRegistry();
    registry.register(decoder('first', ['jvm']));
    registry.register(decoder('second', ['jvm']));
    expect(
      registry.candidatesFor('jvm').map((entry: DecoderDescriptor): string => entry.id),
    ).toEqual(['first', 'second']);
  });

  it('prefers the highest priority as the default', (): void => {
    const registry: DecoderRegistry = new DecoderRegistry();
    registry.register(decoder('low', ['jvm'], 10));
    registry.register(decoder('high', ['jvm'], 90));
    expect(registry.resolve('jvm')?.id).toBe('high');
  });

  it('honours the user selection over priority', (): void => {
    const registry: DecoderRegistry = new DecoderRegistry();
    registry.register(decoder('low', ['jvm'], 10));
    registry.register(decoder('high', ['jvm'], 90));
    registry.setSelection({ jvm: 'low' });
    expect(registry.resolve('jvm')?.id).toBe('low');
  });

  it('falls back to the default when the selection names an unregistered decoder', (): void => {
    // Uninstalling the chosen decoder must not strand the format.
    const registry: DecoderRegistry = new DecoderRegistry();
    registry.register(decoder('remaining', ['jvm'], 10));
    registry.setSelection({ jvm: 'gone' });
    expect(registry.resolve('jvm')?.id).toBe('remaining');
  });

  it('stops offering a decoder once it is unregistered', (): void => {
    const registry: DecoderRegistry = new DecoderRegistry();
    registry.register(decoder('jvm', ['jvm']));
    registry.unregister('jvm');
    expect(registry.resolve('jvm')).toBeNull();
    expect(registry.all()).toEqual([]);
  });

  it('ignores unregistering something that was never registered', (): void => {
    const registry: DecoderRegistry = new DecoderRegistry();
    registry.register(decoder('jvm', ['jvm']));
    registry.unregister('never-there');
    expect(registry.all()).toHaveLength(1);
  });

  it('replaces a re-registered decoder in place, so tie-breaking order cannot shift', (): void => {
    const registry: DecoderRegistry = new DecoderRegistry();
    registry.register(decoder('first', ['jvm'], 50));
    registry.register(decoder('second', ['jvm'], 50));
    // Re-registering the first must not move it behind the second, or the default would change.
    registry.register(decoder('first', ['jvm'], 50));
    expect(registry.all().map((entry: DecoderDescriptor): string => entry.id)).toEqual([
      'first',
      'second',
    ]);
    expect(registry.resolve('jvm')?.id).toBe('first');
  });

  it('carries the resolution through, so an uninstalled decoder explains itself', (): void => {
    const registry: DecoderRegistry = new DecoderRegistry();
    registry.register(
      decoder('jvm', ['jvm'], 100, decoderUnavailable('JVM decoder is not installed')),
    );
    const resolution: DecoderResolution | undefined = registry.resolve('jvm')?.resolve();
    expect(resolution?.available).toBe(false);
    expect(resolution).toEqual({ available: false, reason: 'JVM decoder is not installed' });
  });
});
