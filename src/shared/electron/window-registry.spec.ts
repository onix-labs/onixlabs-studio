import { RegisteredWindow, WindowRegistry } from './window-registry';

/**
 * Represents the stand-in window used by these specs; the registry never inspects it.
 */
interface FakeWindow {
  readonly name: string;
}

describe('WindowRegistry', () => {
  it('whenEmpty_hasNoMainWindowAndNoEntries', () => {
    const registry: WindowRegistry<FakeWindow> = new WindowRegistry<FakeWindow>();
    expect(registry.main()).toBeNull();
    expect(registry.all()).toEqual([]);
  });

  it('add_mintsUniqueIdentifiersAndListsInRegistrationOrder', () => {
    const registry: WindowRegistry<FakeWindow> = new WindowRegistry<FakeWindow>();
    const first: RegisteredWindow<FakeWindow> = registry.add('main', { name: 'main' });
    const second: RegisteredWindow<FakeWindow> = registry.add('popout', { name: 'popout' });
    expect(first.id).not.toBe(second.id);
    expect(
      registry.all().map((entry: RegisteredWindow<FakeWindow>): string => entry.window.name),
    ).toEqual(['main', 'popout']);
  });

  it('main_returnsTheMainWindowAndIgnoresPopouts', () => {
    const registry: WindowRegistry<FakeWindow> = new WindowRegistry<FakeWindow>();
    registry.add('popout', { name: 'popout' });
    const main: FakeWindow = { name: 'main' };
    registry.add('main', main);
    expect(registry.main()).toBe(main);
  });

  it('main_afterRemovingTheMainWindow_returnsNull', () => {
    const registry: WindowRegistry<FakeWindow> = new WindowRegistry<FakeWindow>();
    const entry: RegisteredWindow<FakeWindow> = registry.add('main', { name: 'main' });
    registry.remove(entry.id);
    expect(registry.main()).toBeNull();
  });

  it('main_withTwoMainWindows_returnsTheEarliestRegistered', () => {
    const registry: WindowRegistry<FakeWindow> = new WindowRegistry<FakeWindow>();
    const first: FakeWindow = { name: 'first' };
    registry.add('main', first);
    registry.add('main', { name: 'second' });
    expect(registry.main()).toBe(first);
  });

  it('byId_resolvesRegisteredWindowsAndNullOtherwise', () => {
    const registry: WindowRegistry<FakeWindow> = new WindowRegistry<FakeWindow>();
    const window: FakeWindow = { name: 'main' };
    const entry: RegisteredWindow<FakeWindow> = registry.add('main', window);
    expect(registry.byId(entry.id)).toBe(window);
    expect(registry.byId(999)).toBeNull();
  });

  it('entry_resolvesTheWindowTogetherWithItsKind', () => {
    const registry: WindowRegistry<FakeWindow> = new WindowRegistry<FakeWindow>();
    const window: FakeWindow = { name: 'popout' };
    const added: RegisteredWindow<FakeWindow> = registry.add('popout', window);
    expect(registry.entry(added.id)).toEqual({ id: added.id, kind: 'popout', window });
    expect(registry.entry(999)).toBeNull();
  });

  it('remove_withAnUnknownIdentifier_isANoOp', () => {
    const registry: WindowRegistry<FakeWindow> = new WindowRegistry<FakeWindow>();
    registry.add('main', { name: 'main' });
    registry.remove(999);
    expect(registry.all().length).toBe(1);
  });
});
