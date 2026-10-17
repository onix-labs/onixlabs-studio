import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  DELETE_RUN_CONFIGURATIONS,
  LIST_RUN_CONFIGURATIONS,
  SAVE_RUN_CONFIGURATIONS,
  UNSCOPED_BRIDGE_REQUEST,
} from '@shared/api/ai-types';
import { RunConfiguration } from '@shared/api/studio';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { StudioConfig } from '@shared/angular/services/studio/studio-config';
import { AgentRunConfigurationCapabilities } from './agent-run-configuration-capabilities';

/**
 * The shape the list capability returns.
 */
interface ListResult {
  readonly available: boolean;
  readonly root?: string;
  readonly configurations: readonly RunConfiguration[];
}

/**
 * The shape the mutating capabilities return.
 */
interface WriteResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly ids?: readonly string[];
  readonly configurations?: readonly RunConfiguration[];
}

/**
 * Builds an ordinary node run configuration.
 * @param id The configuration id.
 * @param name The display name.
 * @returns Returns the configuration.
 */
function config(id: string, name: string): RunConfiguration {
  return { id, name, providerKind: 'node', mode: 'run' };
}

describe('AgentRunConfigurationCapabilities', () => {
  let registered: Map<string, AiCapability>;
  let configurations: WritableSignal<readonly RunConfiguration[]>;
  let root: WritableSignal<string | null>;
  let saved: (readonly RunConfiguration[])[];
  let background: Map<string, readonly RunConfiguration[]>;

  /**
   * Invokes a registered capability with the given input.
   * @param name The capability name.
   * @param input The capability input.
   * @returns Returns the capability's result.
   */
  async function call<T>(name: string, input: unknown = {}): Promise<T> {
    const handler: AiCapability | undefined = registered.get(name);
    expect(handler).toBeDefined();
    return (await handler!(input, UNSCOPED_BRIDGE_REQUEST)) as T;
  }

  beforeEach(() => {
    registered = new Map<string, AiCapability>();
    configurations = signal<readonly RunConfiguration[]>([]);
    root = signal<string | null>('/work');
    saved = [];

    const runtimeStub: Pick<AiRuntime, 'registerCapability'> = {
      registerCapability: (name: string, handler: AiCapability): (() => void) => {
        registered.set(name, handler);
        return (): void => undefined;
      },
    };
    background = new Map<string, readonly RunConfiguration[]>();
    const studioStub: Partial<StudioConfig> = {
      runConfigurations: configurations.asReadonly(),
      // The focused root reads and writes the live snapshot; any other root is its own file.
      loadRunConfigurations: (at: string): Promise<readonly RunConfiguration[]> =>
        Promise.resolve(at === root() ? configurations() : (background.get(at) ?? [])),
      saveRunConfigurationsFor: (at: string, next: readonly RunConfiguration[]): Promise<void> => {
        if (at === root()) {
          saved.push(next);
          configurations.set(next);
        } else {
          background.set(at, next);
        }
        return Promise.resolve();
      },
    };
    const activeWorkspaceStub: Partial<ActiveWorkspace> = { rootPath: root.asReadonly() };

    TestBed.configureTestingModule({
      providers: [
        { provide: AiRuntime, useValue: runtimeStub },
        { provide: StudioConfig, useValue: studioStub },
        { provide: ActiveWorkspace, useValue: activeWorkspaceStub },
      ],
    });
    TestBed.inject(AgentRunConfigurationCapabilities);
  });

  it('constructor_registersTheListSaveAndDeleteCapabilities', () => {
    expect(registered.has(LIST_RUN_CONFIGURATIONS)).toBe(true);
    expect(registered.has(SAVE_RUN_CONFIGURATIONS)).toBe(true);
    expect(registered.has(DELETE_RUN_CONFIGURATIONS)).toBe(true);
  });

  it('list_returnsTheWorkspacesConfigurations', async () => {
    configurations.set([config('a', 'A')]);

    const result: ListResult = await call<ListResult>(LIST_RUN_CONFIGURATIONS);

    expect(result.available).toBe(true);
    expect(result.root).toBe('/work');
    expect(result.configurations.map((c: RunConfiguration): string => c.id)).toEqual(['a']);
  });

  it('list_withNoWorkspaceOpen_reportsUnavailableRatherThanEmpty', async () => {
    root.set(null);

    const result: ListResult = await call<ListResult>(LIST_RUN_CONFIGURATIONS);

    expect(result.available).toBe(false);
  });

  it('save_addsNewConfigurations_andReplacesKnownIdsInPlace', async () => {
    configurations.set([config('a', 'A'), config('b', 'B')]);

    const result: WriteResult = await call<WriteResult>(SAVE_RUN_CONFIGURATIONS, {
      configurations: [
        { id: 'b', name: 'B renamed', providerKind: 'node', mode: 'run' },
        { id: 'c', name: 'C', providerKind: 'node', mode: 'run' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.ids).toEqual(['b', 'c']);
    // Replaced in place, so the user's ordering survives an amendment.
    expect(saved[0].map((c: RunConfiguration): string => c.id)).toEqual(['a', 'b', 'c']);
    expect(saved[0][1].name).toBe('B renamed');
  });

  it('save_acceptsACompound_andNormalisesItsProviderKind', async () => {
    configurations.set([config('api', 'API'), config('web', 'Web')]);

    const result: WriteResult = await call<WriteResult>(SAVE_RUN_CONFIGURATIONS, {
      configurations: [{ id: 'all', name: 'Everything', mode: 'run', members: ['api', 'web'] }],
    });

    expect(result.ok).toBe(true);
    expect(saved[0][2].members).toEqual(['api', 'web']);
    expect(saved[0][2].providerKind).toBe('compound');
  });

  it('save_refusesACompoundNamingAMemberThatDoesNotExist_andWritesNothing', async () => {
    configurations.set([config('api', 'API')]);

    const result: WriteResult = await call<WriteResult>(SAVE_RUN_CONFIGURATIONS, {
      configurations: [{ id: 'all', name: 'Everything', mode: 'run', members: ['api', 'ghost'] }],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ghost');
    expect(saved).toEqual([]);
  });

  it('save_refusesAConfigurationMissingItsIdentity', async () => {
    const result: WriteResult = await call<WriteResult>(SAVE_RUN_CONFIGURATIONS, {
      configurations: [{ name: 'Nameless', providerKind: 'node', mode: 'run' }],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('required field');
    expect(saved).toEqual([]);
  });

  it('save_withNoWorkspaceOpen_refusesRatherThanWritingNowhere', async () => {
    root.set(null);

    const result: WriteResult = await call<WriteResult>(SAVE_RUN_CONFIGURATIONS, {
      configurations: [{ id: 'a', name: 'A', providerKind: 'node', mode: 'run' }],
    });

    expect(result.ok).toBe(false);
    expect(saved).toEqual([]);
  });

  it('delete_removesTheNamedConfigurations', async () => {
    configurations.set([config('a', 'A'), config('b', 'B')]);

    const result: WriteResult = await call<WriteResult>(DELETE_RUN_CONFIGURATIONS, { ids: ['a'] });

    expect(result.ok).toBe(true);
    expect(saved[0].map((c: RunConfiguration): string => c.id)).toEqual(['b']);
  });

  it('delete_reportsAnIdThatDoesNotExist_ratherThanSilentlySucceeding', async () => {
    configurations.set([config('a', 'A')]);

    const result: WriteResult = await call<WriteResult>(DELETE_RUN_CONFIGURATIONS, {
      ids: ['ghost'],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ghost');
    expect(saved).toEqual([]);
  });

  it('delete_refusesWhenItWouldOrphanACompoundsMember', async () => {
    configurations.set([
      config('api', 'API'),
      { id: 'all', name: 'Everything', providerKind: 'compound', mode: 'run', members: ['api'] },
    ]);

    const result: WriteResult = await call<WriteResult>(DELETE_RUN_CONFIGURATIONS, {
      ids: ['api'],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('api');
    expect(saved).toEqual([]);
  });

  it('save_fromAnAgentInABackgroundWorkspace_writesItsOwnWorkspaceNotTheFocusedOne', async () => {
    configurations.set([config('focused', 'Focused')]);
    const handler: AiCapability | undefined = registered.get(SAVE_RUN_CONFIGURATIONS);

    const result: WriteResult = (await handler!(
      { configurations: [config('api', 'API')] },
      { owningTabId: 'tab-b', surface: 'workspace', workspaceRoot: '/background' },
    )) as WriteResult;

    expect(result.ok).toBe(true);
    expect(background.get('/background')?.map((c: RunConfiguration): string => c.id)).toEqual([
      'api',
    ]);
    expect(configurations().map((c: RunConfiguration): string => c.id)).toEqual(['focused']);
    expect(saved).toHaveLength(0);
  });
});
