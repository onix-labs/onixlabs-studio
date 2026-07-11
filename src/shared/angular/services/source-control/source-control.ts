import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  GitRunResult,
  RepositoryInfo,
  SourceControlChannel,
  SourceControlClient,
} from '@shared/api/source-control-channels';

/**
 * Builds a {@link SourceControlClient} that forwards each operation to its {@link SourceControlChannel}
 * over the generic transport. Kept as a free function so the client is assembled from a non-null
 * bridge, without per-call presence checks.
 * @param bridge The generic transport to forward over.
 * @returns Returns the client bound to the bridge.
 */
function createClient(bridge: Bridge): SourceControlClient {
  return {
    openRepository: (): Promise<RepositoryInfo | null> =>
      bridge.invoke(SourceControlChannel.OpenRepository),
    resolveRepository: (directory: string): Promise<RepositoryInfo | null> =>
      bridge.invoke(SourceControlChannel.ResolveRepository, directory),
    closeRepository: (root: string): Promise<void> =>
      bridge.invoke(SourceControlChannel.CloseRepository, root),
    status: (root: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Status, root),
    log: (root: string, limit: number): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Log, root, limit),
    refs: (root: string): Promise<GitRunResult> => bridge.invoke(SourceControlChannel.Refs, root),
    stashes: (root: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Stashes, root),
    commitFiles: (root: string, hash: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.CommitFiles, root, hash),
    readBlob: (root: string, revision: string, filePath: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.ReadBlob, root, revision, filePath),
    discard: (root: string, paths: readonly string[]): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Discard, root, paths),
    stage: (root: string, paths: readonly string[]): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Stage, root, paths),
    unstage: (root: string, paths: readonly string[]): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Unstage, root, paths),
    commit: (root: string, message: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Commit, root, message),
    stash: (root: string): Promise<GitRunResult> => bridge.invoke(SourceControlChannel.Stash, root),
    checkout: (root: string, branch: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Checkout, root, branch),
    createBranch: (root: string, name: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.CreateBranch, root, name),
    fetch: (root: string): Promise<GitRunResult> => bridge.invoke(SourceControlChannel.Fetch, root),
    pull: (root: string): Promise<GitRunResult> => bridge.invoke(SourceControlChannel.Pull, root),
    push: (root: string, remote?: string, branch?: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Push, root, remote, branch),
  };
}

/**
 * Represents the renderer-side client for the version-control (git) capability. It wraps the generic
 * {@link Bridge} transport, exposing the typed {@link SourceControlClient} operations under
 * {@link SourceControl.client}.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the bridge
 * is absent and {@link SourceControl.client} is undefined, so consumers render their empty/unavailable
 * state exactly as before, when the operations were read from `window.studio.sourceControl`.
 */
@Service()
export class SourceControl {
  /**
   * Gets the version-control operations, or undefined when running outside Electron.
   */
  public readonly client: SourceControlClient | undefined = window.bridge
    ? createClient(window.bridge)
    : undefined;
}
