import { describe, expect, it } from 'vitest';
import { PluginInstallChange, PluginInstallEvents } from './plugin-install-events';

describe('PluginInstallEvents (#881)', () => {
  const change: PluginInstallChange = { pluginId: 'git', kind: 'removed', contributions: [] };

  it('emit_tellsEveryListener', () => {
    const events: PluginInstallEvents = new PluginInstallEvents();
    const heard: string[] = [];
    events.on((): void => void heard.push('hosting'));
    events.on((): void => void heard.push('version-control'));

    events.emit(change);

    expect(heard).toEqual(['hosting', 'version-control']);
  });

  it('emit_whenOneListenerThrows_stillTellsTheRest', () => {
    // One host failing to stop its plugin must not leave the others serving theirs.
    const events: PluginInstallEvents = new PluginInstallEvents();
    const heard: string[] = [];
    events.on((): void => {
      throw new Error('could not stop');
    });
    events.on((): void => void heard.push('version-control'));

    events.emit(change);

    expect(heard).toEqual(['version-control']);
  });

  it('on_returnsAWayToStopListening', () => {
    const events: PluginInstallEvents = new PluginInstallEvents();
    const heard: string[] = [];
    const stop: () => void = events.on((): void => void heard.push('heard'));

    stop();
    events.emit(change);

    expect(heard).toEqual([]);
  });
});
