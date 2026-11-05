import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebugResolveResult } from '@shared/api/debug-channels';

/**
 * A handler the resolver registered on the IPC bus.
 */
type IpcHandler = (event: unknown, request: unknown) => Promise<DebugResolveResult>;

let handler: IpcHandler | undefined;

vi.mock('electron', () => ({
  ipcMain: {
    handle: (_channel: string, registered: IpcHandler): void => {
      handler = registered;
    },
  },
}));

const { DebugLaunchResolver } = await import('./debug-launch-resolver');
const { WorkspaceContext } = await import('../workspace-context');
type ProjectSystemRegistry = import('../project-system/project-system').ProjectSystemRegistry;

describe('DebugLaunchResolver', () => {
  const root: string = '/workspace';
  const configuration: Record<string, unknown> = { id: 'c1', providerKind: 'dotnet' };
  let systems: Map<string, unknown>;

  beforeEach(() => {
    systems = new Map<string, unknown>();
    const workspace: InstanceType<typeof WorkspaceContext> = new WorkspaceContext();
    workspace.addRoot(root);
    new DebugLaunchResolver(systems as unknown as ProjectSystemRegistry, workspace).register();
  });

  /**
   * Resolves a request as the renderer would.
   * @param request The request.
   * @returns Returns the result.
   */
  function resolve(request: unknown): Promise<DebugResolveResult> {
    if (handler === undefined) {
      throw new Error('Nothing is registered');
    }
    return handler({}, request);
  }

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['aString', 'x'],
    ['noRoot', { configuration }],
    ['aNullConfiguration', { configuration: null, rootPath: root }],
    ['noConfiguration', { rootPath: root }],
    ['aConfigurationOfTheWrongType', { configuration: 'c', rootPath: root }],
    ['noId', { configuration: { providerKind: 'dotnet' }, rootPath: root }],
    ['noProvider', { configuration: { id: 'c1' }, rootPath: root }],
  ])('refuses_%s', async (_name: string, request: unknown) => {
    expect(await resolve(request)).toEqual({ target: null, error: 'Invalid resolve request.' });
  });

  it('refusesARootThatIsNotOpen_withoutAskingTheProjectSystem', async () => {
    const resolveDebugTarget: ReturnType<typeof vi.fn> = vi.fn();
    systems.set('dotnet', { resolveDebugTarget });

    const result: DebugResolveResult = await resolve({ configuration, rootPath: '/elsewhere' });

    expect(result).toEqual({ target: null, error: 'Workspace root is not open.' });
    expect(resolveDebugTarget).not.toHaveBeenCalled();
  });

  it('delegatesToTheProjectSystem', async () => {
    const target: DebugResolveResult = { target: { program: '/out/app.dll' }, error: null };
    systems.set('dotnet', { resolveDebugTarget: (): DebugResolveResult => target });

    expect(await resolve({ configuration, rootPath: root })).toBe(target);
  });

  it('fallsBackToTheConfiguredProgram_forAProviderWithNoResolver', async () => {
    systems.set('dotnet', {});

    const result: DebugResolveResult = await resolve({
      configuration: { ...configuration, program: '/bin/app', cwd: '/w' },
      rootPath: root,
    });

    expect(result).toEqual({ target: { program: '/bin/app', cwd: '/w' }, error: null });
  });

  it.each<[string, unknown]>([
    ['noProgram', undefined],
    ['anEmptyProgram', ''],
  ])('saysSo_forAProviderWithNoResolverAnd_%s', async (_name: string, program: unknown) => {
    const result: DebugResolveResult = await resolve({
      configuration: { ...configuration, program },
      rootPath: root,
    });

    expect(result).toEqual({
      target: null,
      error: 'No debug launch target for dotnet configurations.',
    });
  });
});
