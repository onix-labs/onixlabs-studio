// Shared IPC channel names used between the Electron main process and the renderer.
// Keep this module platform-neutral (no Node or DOM dependencies) so both compilation
// targets can import it.

/**
 * Specifies the IPC channel names used for communication between the renderer and main processes.
 */
export enum IpcChannel {
  /**
   * Gets the agent's current authentication status.
   */
  AiAuthStatus = 'ai:auth-status',

  /**
   * Stores a user-supplied API key for the agent.
   */
  AiSetApiKey = 'ai:set-api-key',

  /**
   * Clears any stored agent API key.
   */
  AiClearApiKey = 'ai:clear-api-key',

  /**
   * Runs a minimal agent turn to verify authentication end-to-end.
   */
  AiVerify = 'ai:verify',

  /**
   * Lists the registered agent providers and their availability.
   */
  AiListProviders = 'ai:list-providers',

  /**
   * Starts an agent turn.
   */
  AiRun = 'ai:run',

  /**
   * Aborts a running agent turn.
   */
  AiAbort = 'ai:abort',

  /**
   * Carries a streamed event from a running agent turn to the renderer.
   */
  AiEvent = 'ai:event',

  /**
   * Carries an in-app capability request from the main process to the renderer.
   */
  AiBridgeRequest = 'ai:bridge-request',

  /**
   * Carries the renderer's reply to an in-app capability request.
   */
  AiBridgeReply = 'ai:bridge-reply',

  /**
   * Carries the renderer's answer to an agent permission request.
   */
  AiPermissionReply = 'ai:permission-reply',

  /**
   * Shows an open-folder dialog and resolves the chosen folder's git repository root.
   */
  SourceControlOpenRepository = 'source-control:open-repository',

  /**
   * Resolves the git repository root that contains an already-open folder, without a dialog.
   */
  SourceControlResolveRepository = 'source-control:resolve-repository',

  /**
   * Releases an open repository root, removing it from the set git operations are confined to.
   */
  SourceControlCloseRepository = 'source-control:close-repository',

  /**
   * Reads the working-tree status (branch, ahead/behind, and changed files) of a repository.
   */
  SourceControlStatus = 'source-control:status',

  /**
   * Reads the commit history (with parents and decorations) of a repository.
   */
  SourceControlLog = 'source-control:log',

  /**
   * Reads the branches and tags of a repository.
   */
  SourceControlRefs = 'source-control:refs',

  /**
   * Reads the stash entries of a repository.
   */
  SourceControlStashes = 'source-control:stashes',

  /**
   * Reads the files changed by a single commit.
   */
  SourceControlCommitFiles = 'source-control:commit-files',

  /**
   * Reads the contents of a file at a given revision (or the working tree) for a diff.
   */
  SourceControlReadBlob = 'source-control:read-blob',

  /**
   * Stages files (or the whole working tree) into the index.
   */
  SourceControlStage = 'source-control:stage',

  /**
   * Unstages files (or the whole index) back to the working tree.
   */
  SourceControlUnstage = 'source-control:unstage',

  /**
   * Commits the staged changes with a message.
   */
  SourceControlCommit = 'source-control:commit',

  /**
   * Stashes the working-tree changes.
   */
  SourceControlStash = 'source-control:stash',

  /**
   * Checks out an existing branch.
   */
  SourceControlCheckout = 'source-control:checkout',

  /**
   * Creates a new branch at the current head and checks it out.
   */
  SourceControlCreateBranch = 'source-control:create-branch',

  /**
   * Fetches all remotes, pruning deleted remote-tracking branches.
   */
  SourceControlFetch = 'source-control:fetch',

  /**
   * Pulls the current branch from its upstream.
   */
  SourceControlPull = 'source-control:pull',

  /**
   * Pushes the current branch to its upstream, setting it on the first push.
   */
  SourceControlPush = 'source-control:push',
}
