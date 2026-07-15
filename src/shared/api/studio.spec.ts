import { describe, expect, it } from 'vitest';
import {
  defaultUser,
  defaultWorkspace,
  parseUser,
  parseWorkspace,
  resolveSelectedRunConfiguration,
  RunConfiguration,
  serializeUser,
  serializeWorkspace,
  STUDIO_SCHEMA_VERSION,
  StudioSnapshot,
  StudioUser,
  StudioWorkspace,
} from './studio';

/**
 * Builds a run configuration with the given id and name.
 * @param id The configuration id.
 * @param name The configuration name.
 * @returns Returns the configuration.
 */
function config(id: string, name: string): RunConfiguration {
  return { id, name, providerKind: 'dotnet', mode: 'run' };
}

describe('parseWorkspace', () => {
  it('defaultsWhenNotAnObject', () => {
    expect(parseWorkspace(null)).toEqual(defaultWorkspace());
    expect(parseWorkspace('nonsense')).toEqual(defaultWorkspace());
    expect(parseWorkspace([])).toEqual(defaultWorkspace());
  });

  it('keepsWellFormedRunConfigurationsAndDropsMalformedOnes', () => {
    const parsed: StudioWorkspace = parseWorkspace({
      version: 1,
      runConfigurations: [
        { id: 'a', name: 'A', providerKind: 'dotnet', mode: 'debug' },
        { id: 'b', name: 'B', providerKind: 'node' },
        { name: 'no-id', providerKind: 'dotnet' },
        'garbage',
      ],
    });
    expect(parsed.runConfigurations).toHaveLength(2);
    expect(parsed.runConfigurations[0]).toMatchObject({ id: 'a', mode: 'debug' });
    // A configuration without an explicit mode falls back to 'run'.
    expect(parsed.runConfigurations[1]).toMatchObject({ id: 'b', mode: 'run' });
  });

  it('coercesOptionalFieldsAndDropsNonStringArgsAndEnv', () => {
    const parsed: StudioWorkspace = parseWorkspace({
      runConfigurations: [
        {
          id: 'a',
          name: 'A',
          providerKind: 'dotnet',
          args: ['--flag', 7, null, 'x'],
          env: { GOOD: 'v', BAD: 3 },
        },
      ],
    });
    expect(parsed.runConfigurations[0].args).toEqual(['--flag', 'x']);
    expect(parsed.runConfigurations[0].env).toEqual({ GOOD: 'v' });
  });

  it('roundTripsThroughSerialization', () => {
    const workspace: StudioWorkspace = {
      version: STUDIO_SCHEMA_VERSION,
      runConfigurations: [config('a', 'A')],
      providerKind: 'dotnet',
    };
    expect(parseWorkspace(JSON.parse(serializeWorkspace(workspace)))).toEqual(workspace);
  });
});

describe('parseUser', () => {
  it('defaultsWhenNotAnObject', () => {
    expect(parseUser(null)).toEqual(defaultUser());
  });

  it('readsOnlyTheTransientSelectionFieldsAndIgnoresForeignFields', () => {
    const parsed: StudioUser = parseUser({
      version: 1,
      selectedRunConfigurationId: 'a',
      lastTarget: 'x64',
      lastBuildConfiguration: 'release',
      // A hand-edit trying to redefine a shared configuration must be ignored.
      runConfigurations: [{ id: 'a', name: 'HIJACK', providerKind: 'dotnet', mode: 'run' }],
    });
    expect(parsed).toEqual({
      version: 1,
      selectedRunConfigurationId: 'a',
      lastTarget: 'x64',
      lastBuildConfiguration: 'release',
    });
    expect(parsed).not.toHaveProperty('runConfigurations');
  });

  it('roundTripsThroughSerialization', () => {
    const user: StudioUser = { version: STUDIO_SCHEMA_VERSION, selectedRunConfigurationId: 'a' };
    expect(parseUser(JSON.parse(serializeUser(user)))).toEqual(user);
  });
});

describe('resolveSelectedRunConfiguration', () => {
  /**
   * Builds a snapshot from shared configurations and an optional selection.
   * @param configurations The shared configurations.
   * @param selectedRunConfigurationId The selected id, when any.
   * @returns Returns the snapshot.
   */
  function snapshot(
    configurations: readonly RunConfiguration[],
    selectedRunConfigurationId?: string,
  ): StudioSnapshot {
    return {
      workspace: { version: 1, runConfigurations: configurations },
      user: { version: 1, selectedRunConfigurationId },
    };
  }

  it('returnsNullWhenThereAreNoConfigurations', () => {
    expect(resolveSelectedRunConfiguration(snapshot([], 'a'))).toBeNull();
  });

  it('prefersTheUserSelectionWhenItStillExists', () => {
    const configs: RunConfiguration[] = [config('a', 'A'), config('b', 'B')];
    expect(resolveSelectedRunConfiguration(snapshot(configs, 'b'))?.id).toBe('b');
  });

  it('fallsBackToTheFirstWhenTheSelectionIsStaleOrAbsent', () => {
    const configs: RunConfiguration[] = [config('a', 'A'), config('b', 'B')];
    expect(resolveSelectedRunConfiguration(snapshot(configs, 'gone'))?.id).toBe('a');
    expect(resolveSelectedRunConfiguration(snapshot(configs))?.id).toBe('a');
  });
});
