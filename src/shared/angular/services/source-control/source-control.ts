import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  GitRunResult,
  RepositoryInfo,
  SourceControlChannel,
  SourceControlClient,
} from '@shared/api/source-control-channels';
import { Log } from '@shared/angular/services/log/log';

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
    remotes: (root: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Remotes, root),
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
    stashApply: (root: string, index: number): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.StashApply, root, index),
    stashPop: (root: string, index: number): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.StashPop, root, index),
    stashDrop: (root: string, index: number): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.StashDrop, root, index),
    checkout: (root: string, branch: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Checkout, root, branch),
    createBranch: (root: string, name: string, checkout: boolean): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.CreateBranch, root, name, checkout),
    fetch: (root: string): Promise<GitRunResult> => bridge.invoke(SourceControlChannel.Fetch, root),
    fetchRef: (
      root: string,
      remote: string,
      sourceRef: string,
      localBranch: string,
    ): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.FetchRef, root, remote, sourceRef, localBranch),
    pull: (root: string): Promise<GitRunResult> => bridge.invoke(SourceControlChannel.Pull, root),
    push: (
      root: string,
      remote?: string,
      branch?: string,
      setUpstream?: boolean,
    ): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.Push, root, remote, branch, setUpstream),
    fetchRemote: (root: string, remote: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.FetchRemote, root, remote),
    pruneRemote: (root: string, remote: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.PruneRemote, root, remote),
    addRemote: (root: string, name: string, url: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.AddRemote, root, name, url),
    removeRemote: (root: string, name: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.RemoveRemote, root, name),
    checkoutTracking: (
      root: string,
      remoteBranch: string,
      localBranch: string,
    ): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.CheckoutTracking, root, remoteBranch, localBranch),
    createTag: (
      root: string,
      name: string,
      commit: string,
      message?: string,
    ): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.CreateTag, root, name, commit, message),
    deleteTag: (root: string, name: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.DeleteTag, root, name),
    deleteRemoteTag: (root: string, remote: string, name: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.DeleteRemoteTag, root, remote, name),
    pushTag: (root: string, remote: string, name: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.PushTag, root, remote, name),
    pushAllTags: (root: string, remote: string): Promise<GitRunResult> =>
      bridge.invoke(SourceControlChannel.PushAllTags, root, remote),
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

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Initialises a new instance of the {@link SourceControl} class, recording whether the source-control
   * bridge is available in the current environment.
   */
  public constructor() {
    this.log.debug(
      'SourceControl',
      `Source-control client ${this.client === undefined ? 'unavailable' : 'ready'}`,
    );
  }
}
