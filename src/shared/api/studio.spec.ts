import { describe, expect, it } from 'vitest';
import {
  COMPOUND_PROVIDER_KIND,
  findRunConfigurationIssues,
  defaultUser,
  defaultWorkspace,
  expandRunConfiguration,
  isCompoundConfiguration,
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

  it('parse_readsThePresentation_andDropsForeignValues', () => {
    const parsed: StudioWorkspace = parseWorkspace({
      runConfigurations: [
        { id: 'a', name: 'A', providerKind: 'node', presentation: 'window' },
        { id: 'b', name: 'B', providerKind: 'node', presentation: 'panel' },
        { id: 'c', name: 'C', providerKind: 'node', presentation: 'billboard' },
        { id: 'd', name: 'D', providerKind: 'node' },
      ],
    });
    expect(
      parsed.runConfigurations.map(
        (configuration: RunConfiguration): string | undefined => configuration.presentation,
      ),
    ).toEqual(['window', 'panel', undefined, undefined]);
  });

  it('presentation_roundTripsThroughSerialization', () => {
    const workspace: StudioWorkspace = {
      version: STUDIO_SCHEMA_VERSION,
      runConfigurations: [{ ...config('a', 'A'), presentation: 'window' }],
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

describe('compound run configurations', () => {
  /**
   * Builds a compound naming the given member ids.
   * @param id The compound's id.
   * @param members The member ids.
   * @returns Returns the compound.
   */
  function compound(id: string, members: readonly string[]): RunConfiguration {
    return {
      id,
      name: id,
      providerKind: COMPOUND_PROVIDER_KIND,
      mode: 'run',
      members,
    };
  }

  it('parse_readsMembers_andDefaultsTheProviderKindOfAnAuthoredCompound', () => {
    // A hand-written compound need not name a provider kind: Studio, not an ecosystem, launches it.
    const parsed: StudioWorkspace = parseWorkspace({
      version: 1,
      runConfigurations: [{ id: 'stack', name: 'Stack', mode: 'run', members: ['api', 'web'] }],
    });

    expect(parsed.runConfigurations).toHaveLength(1);
    expect(parsed.runConfigurations[0].members).toEqual(['api', 'web']);
    expect(parsed.runConfigurations[0].providerKind).toBe(COMPOUND_PROVIDER_KIND);
    expect(isCompoundConfiguration(parsed.runConfigurations[0])).toBe(true);
  });

  it('parse_dropsMalformedMembers_andTreatsAnEmptyListAsNotACompound', () => {
    const parsed: StudioWorkspace = parseWorkspace({
      version: 1,
      runConfigurations: [
        { id: 'a', name: 'A', providerKind: 'node', mode: 'run', members: ['keep', 7, '', null] },
        { id: 'b', name: 'B', providerKind: 'node', mode: 'run', members: [] },
        { id: 'c', name: 'C', providerKind: 'node', mode: 'run', members: 'nope' },
      ],
    });

    expect(parsed.runConfigurations[0].members).toEqual(['keep']);
    // Nothing usable left, so these are ordinary configurations rather than compounds that run nothing.
    expect(parsed.runConfigurations[1].members).toBeUndefined();
    expect(parsed.runConfigurations[2].members).toBeUndefined();
  });

  it('expand_returnsTheConfigurationItselfWhenItIsNotACompound', () => {
    const single: RunConfiguration = config('a', 'A');

    expect(expandRunConfiguration(single, [single])).toEqual([single]);
  });

  it('expand_resolvesMembersInDeclarationOrder_andNests', () => {
    const db: RunConfiguration = config('db', 'Database');
    const api: RunConfiguration = config('api', 'API');
    const web: RunConfiguration = config('web', 'Web');
    const backEnd: RunConfiguration = compound('back-end', ['db', 'api']);
    const stack: RunConfiguration = compound('stack', ['back-end', 'web']);

    const leaves: readonly RunConfiguration[] = expandRunConfiguration(stack, [
      db,
      api,
      web,
      backEnd,
      stack,
    ]);

    expect(leaves.map((leaf: RunConfiguration): string => leaf.id)).toEqual(['db', 'api', 'web']);
  });

  it('expand_dropsUnknownMembers_andBreaksCyclesIncludingSelfReference', () => {
    const api: RunConfiguration = config('api', 'API');
    const selfish: RunConfiguration = compound('selfish', ['api', 'ghost', 'selfish']);

    expect(
      expandRunConfiguration(selfish, [api, selfish]).map(
        (leaf: RunConfiguration): string => leaf.id,
      ),
    ).toEqual(['api']);

    // A two-step cycle terminates just as surely, and neither compound is launched as a leaf.
    const left: RunConfiguration = compound('left', ['right']);
    const right: RunConfiguration = compound('right', ['left', 'api']);
    expect(
      expandRunConfiguration(left, [left, right, api]).map(
        (leaf: RunConfiguration): string => leaf.id,
      ),
    ).toEqual(['api']);
  });

  it('expand_visitsEachConfigurationOnce_soADiamondStartsItOnce', () => {
    const api: RunConfiguration = config('api', 'API');
    const one: RunConfiguration = compound('one', ['api']);
    const two: RunConfiguration = compound('two', ['api']);
    const both: RunConfiguration = compound('both', ['one', 'two']);

    expect(
      expandRunConfiguration(both, [api, one, two, both]).map(
        (leaf: RunConfiguration): string => leaf.id,
      ),
    ).toEqual(['api']);
  });
});

describe('findRunConfigurationIssues', () => {
  /**
   * Builds a compound naming the given member ids.
   * @param id The compound's id.
   * @param members The member ids.
   * @returns Returns the compound.
   */
  function compound(id: string, members: readonly string[]): RunConfiguration {
    return { id, name: id, providerKind: COMPOUND_PROVIDER_KIND, mode: 'run', members };
  }

  it('acceptsASoundSet', () => {
    const api: RunConfiguration = config('api', 'API');
    const web: RunConfiguration = config('web', 'Web');

    expect(findRunConfigurationIssues([api, web, compound('all', ['api', 'web'])])).toEqual([]);
  });

  it('reportsADuplicateId', () => {
    const issues: readonly string[] = findRunConfigurationIssues([
      config('a', 'A'),
      config('a', 'B'),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('Duplicate run configuration id "a"');
  });

  it('reportsAMemberThatDoesNotExist', () => {
    const issues: readonly string[] = findRunConfigurationIssues([
      config('api', 'API'),
      compound('all', ['api', 'ghost']),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('"ghost"');
  });

  it('reportsSelfReferenceAndCycles', () => {
    expect(findRunConfigurationIssues([compound('self', ['self'])])[0]).toContain('names itself');

    const cycle: readonly string[] = findRunConfigurationIssues([
      compound('left', ['right']),
      compound('right', ['left']),
    ]);
    expect(cycle.some((issue: string): boolean => issue.startsWith('Compound cycle:'))).toBe(true);
  });

  it('acceptsADiamond_whichIsNotACycle', () => {
    const api: RunConfiguration = config('api', 'API');

    expect(
      findRunConfigurationIssues([
        api,
        compound('one', ['api']),
        compound('two', ['api']),
        compound('both', ['one', 'two']),
      ]),
    ).toEqual([]);
  });
});
