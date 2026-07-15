import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { DebugChannel, DebugResolveResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
import { ProjectSystem, ProjectSystemRegistry } from '../project-system/project-system';
import { WorkspaceContext } from '../workspace-context';

/**
 * A parsed, validated resolve request.
 */
interface ResolveRequest {
  /**
   * Gets the run configuration to resolve into a launch target.
   */
  readonly configuration: RunConfiguration;

  /**
   * Gets the absolute workspace root the session is rooted at.
   */
  readonly rootPath: string;
}

/**
 * Turns a run configuration into a concrete debug launch target on the main process, so the renderer
 * never builds a project or resolves an artifact itself. It delegates to the project system that owns
 * the configuration's provider — for .NET, compiling the project and locating its output assembly — and
 * confines the work to the open workspace root. A provider without a debug resolver falls back to the
 * configuration's own program. This is the debug counterpart of how the project systems already run
 * MSBuild queries in main; the renderer folds the returned target into its DAP `launch` request.
 */
export class DebugLaunchResolver {
  /**
   * Holds the registry the owning provider is resolved through.
   */
  private readonly projectSystems: ProjectSystemRegistry;

  /**
   * Holds the open-workspace tracker used to confine resolution to opened roots.
   */
  private readonly workspaceContext: WorkspaceContext;

  /**
   * Initializes a new instance of the {@link DebugLaunchResolver} class.
   * @param projectSystems The registry resolving a provider kind to its project system.
   * @param workspaceContext The open-workspace tracker used to confine resolution to opened roots.
   */
  public constructor(
    projectSystems: ProjectSystemRegistry,
    workspaceContext: WorkspaceContext,
  ) {
    this.projectSystems = projectSystems;
    this.workspaceContext = workspaceContext;
  }

  /**
   * Registers the resolve IPC handler.
   */
  public register(): void {
    ipcMain.handle(
      DebugChannel.Resolve,
      (_event: IpcMainInvokeEvent, request: unknown): Promise<DebugResolveResult> =>
        this.resolve(request),
    );
  }

  /**
   * Resolves a validated request into a launch target, confined to an open workspace root.
   * @param request The resolve request from the renderer.
   * @returns Returns the resolved target, or a reason it could not be resolved.
   */
  private async resolve(request: unknown): Promise<DebugResolveResult> {
    const parsed: ResolveRequest | null = this.parse(request);
    if (parsed === null) {
      return { target: null, error: 'Invalid resolve request.' };
    }
    if (!this.workspaceContext.isRoot(parsed.rootPath)) {
      return { target: null, error: 'Workspace root is not open.' };
    }
    const system: ProjectSystem | undefined = this.projectSystems.get(
      parsed.configuration.providerKind,
    );
    if (system?.resolveDebugTarget === undefined) {
      // No provider resolver: launch the configuration's own program directly, when it names one.
      const program: string | undefined = parsed.configuration.program;
      return program !== undefined && program.length > 0
        ? { target: { program, cwd: parsed.configuration.cwd }, error: null }
        : {
            target: null,
            error: `No debug launch target for ${parsed.configuration.providerKind} configurations.`,
          };
    }
    return system.resolveDebugTarget(parsed.configuration, parsed.rootPath);
  }

  /**
   * Validates and narrows an untrusted resolve request.
   * @param request The request value.
   * @returns Returns the parsed request, or null when it is malformed.
   */
  private parse(request: unknown): ResolveRequest | null {
    if (request === null || typeof request !== 'object') {
      return null;
    }
    const record: { configuration?: unknown; rootPath?: unknown } = request;
    if (typeof record.rootPath !== 'string' || record.configuration === null) {
      return null;
    }
    const configuration: unknown = record.configuration;
    if (typeof configuration !== 'object' || configuration === undefined) {
      return null;
    }
    const shape: { id?: unknown; providerKind?: unknown } = configuration as {
      id?: unknown;
      providerKind?: unknown;
    };
    if (typeof shape.id !== 'string' || typeof shape.providerKind !== 'string') {
      return null;
    }
    return { configuration: configuration as RunConfiguration, rootPath: record.rootPath };
  }
}
