# Source Control Integration — status & handoff

Working notes for the git/VCS integration on branch **`feature/git-integration`**.
Last updated after slice 7 (docked agent + terminal panels).

## Direction

Real version control behind a **provider adapter** (`SourceControlProvider`), with
`GitProvider` as the first implementation; SVN/others are a **separate, later epic**
(the seam exists, they are out of scope here). The source-control tab **opens a
repository**; the directory (workspace) tab gets **lightweight** git (status
decorations + a few ops). The git CLI runs only in the **main process**, via
`execFile` with array args, every operand validated and confined to an opened root.

## Done (committed on `feature/git-integration`)

| Commit | Slice | Delivered |
| --- | --- | --- |
| `8224c9a` | 1 — read-only | provider adapter + safe `GitManager`; SC tab opens a repo; real history/branches/tags/stashes/diffs |
| `b0aa3dc` | 2 — local mutations | stage/unstage (all + per-file), commit (composer), stash; ribbon wired |
| `8b24543` | 3 — workspace git | refcounted repo roots; `WorkspaceGit`; M/A/D decorations in File + Solution explorers |
| `bc6c59b` | 4 — branch ops | checkout (hover action) + create branch (modal) |
| _(pending)_ | 5 — network | `fetch`/`pull`/`push` end-to-end; non-interactive env + 120s timeout for network ops; push auto-sets upstream; SC ribbon Fetch/Pull/Push wired |
| _(pending)_ | 6 — ribbon cross-view | unified per-type tab dedup (`Tab.resourceKey`); directory ribbon Source Control group (big "Source Control" + small Commit/Push/Pull); SC ribbon "Open as Workspace"; workspace commit panel reuses `CommitDetail` |
| _(pending)_ | 7 — docked panels | agent panel on SC tabs; interactive terminal panel on both tabs (new docked `TerminalPanel` reusing `TerminalView`), rooted at the folder/repo via `DockTabContext` |

(These sit on top of the earlier source-control **scaffold** + **dock rehost** commits:
`4a50a53`, `a770ead`, `9482b35`.)

> Slices 5–7 are implemented and green in the working tree but **not yet committed**
> (build, electron `tsc`, `eslint .`, and `ng test` all pass — 3 known unrelated failures).

## Architecture map

**Main process** — `src/electron/git-manager.ts` (`GitManager`): `execFile git`,
`isSafeOperand`/`confinedPaths` guards, **refcounted** opened-roots `Map`. Network ops go
through `runNetwork` (non-interactive `GIT_NETWORK_ENV` + 120s timeout). Channels
in `src/shared/ipc-channels.ts` (`source-control:*`), bridge types in
`src/shared/studio-api.ts` (`SourceControlApi`/`RepositoryInfo`/`GitRunResult`),
exposed as `window.studio.sourceControl` in `src/electron/preload.ts`, wired in
`src/electron/main.ts`.

**Renderer** — `src/angular/services/source-control/`:
- `source-control-provider.ts` — the interface (`MutationResult`, `FileDiff`, ops).
- `git-provider.ts` — `GitProvider` (calls the bridge).
- `git-output.ts` — **pure parsers** (status v2, log, for-each-ref, stash, diff-tree); unit-tested in `git-output.spec.ts`.
- `source-control-providers.ts` — `SourceControlProviders` factory (the adapter seam).

**Per-tab state**:
- `services/repository/repository.ts` — `Repository` (SC tab): bind/close/refresh, selection, lazy commit files + diffs, mutations (stage/unstage/commit/stash/checkout/createBranch), `commitMessage` draft. Types + `statusLetter()` in `repository-data.ts`.
- `services/workspace-git/workspace-git.ts` — `WorkspaceGit` (directory tab): resolves repo, `statusFor(path)`/`hasChanges(path)` for decorations.
- `services/repositories/` — `Repositories` handoff registry + `RepositoryOpener` (the "Open Repository" flow).
- `services/diffs/` — `Diffs` store + `DiffOpener` (diffs open in the document well).

**UI** — `components/views/source-control-view/` (dock host: `repository-dock-blueprint.ts`
+ panels `source-control-sidebar`, `commit-graph`, `commit-detail`, `diff-view`,
`diff-document-panel`). Decorations added to `components/panels/tree-panel` and
`components/panels/solution-panel`.

**Cross-view & dedup (slice 6)**:
- **Tab dedup** — `services/tabs/tab.ts` adds `resourceKey`; `Tabs.open(type, key?)` +
  `findByResource(type, key)` keep a resource single-instance per tab type. The directory,
  source-control, and code/markdown open flows (`file-opener`, `repositories/repository-opener`,
  `documents.openFileInfo`) all consult it and **focus** an existing tab instead of duplicating.
- **Ribbon round-trip** — `services/workspace-source-control-commands/` is the directory-ribbon
  twin of `SourceControlCommands`. The active `DirectoryView` registers a handler exposing
  open-in-source-control / commit / push / pull. The directory ribbon's Source Control group is
  big "Source Control" (→ `RepositoryOpener.openFolder`) + small Commit/Push/Pull; the SC ribbon's
  "Open as Workspace" calls `FileOpener.openDirectoryPath` (new) via `Workspace.readDirectoryListing`
  (new) and `SourceControlCommandHandler.openAsWorkspace`.
- **Workspace commit panel** — `DirectoryView` now provides scoped `Repository` + `Diffs` +
  `DiffOpener`, **lazily binds** the repository on first source-control action (own refcounted
  hold, released in `ngOnDestroy`), and reveals the reused `CommitDetail` as a `commit` dock panel.
  Push/pull go through the scoped `Repository`, then `WorkspaceGit.refresh()` updates decorations.

**Docked panels (slice 7)**:
- **Agent on SC tabs** — `repository-dock-blueprint.ts` adds the reusable `'agent'` panel
  (`AgentPanel`→`AgentChat`, own per-conversation `Agent`) in its own right-column stack. (Its
  `Agent` resolves the root `Workspace` in an SC tab, so its file tooling is unscoped for now.)
- **Terminal on both tabs** — new docked `components/panels/terminal-panel/` wraps the existing
  `TerminalView` (which gained an optional `cwd` input → `bridge.create`). A per-tab
  `services/dock/dock-tab-context.ts` (`DockTabContext`, provided by both views) carries the tab id
  (→ globally-unique `term-${tabId}` session) and rooted folder (→ `cwd`); the panel renders only
  once the root is known. The terminal is tabbed with Output/Error List (`defaultLayout()`, workspace)
  and with History (`REPOSITORY_DOCK_BLUEPRINT`, SC); the SC agent shares the right column with Commit
  in its own stack. `TerminalView.ngOnDestroy` disposes the PTY on tab close. **Note:** tool stacks
  render only their active panel, so switching to a sibling tab (e.g. Output) destroys the terminal and
  resets its shell session; the session is re-created on return. Persisting it would need a docked
  mounted-but-hidden pattern (a future enhancement).

## Remaining work

1. **Discard changes (follow-up)** — per-file revert in the commit panel's Changes
   group; **needs a confirm dialog** (destructive). Handle tracked (`git restore
   --staged --worktree`) vs untracked (delete) cases.
2. **Auth (follow-up)** — in-app credential entry is a later epic. Today network ops lean
   entirely on the user's git credential helper + ssh-agent and **fail fast** when none is
   available (`GIT_TERMINAL_PROMPT=0`, non-interactive `GIT_SSH_COMMAND`); failures surface
   via `GitRunResult.stderr` but are not yet shown in a rich error UI.

Then **polish/housekeeping**: reconcile GitHub tickets **#96–99** (they predate the
GitKraken tab, have **no milestone**; re-scope #97 toward the provider abstraction),
and add tickets for the SC-tab view, decorations-in-Solution, and the agent/terminal
panels.

## Caveats / open items

- **Live validation**: the user has been running it but needs a rich test repo (now
  scripted — see below). Parsers are unit-tested; the rest was build/lint/test-green
  but only spot-checked live.
- **`WorkspaceGit` has no unit spec** (needs `window.studio` + async-effect mocking).
- **3 pre-existing, unrelated test failures** on the branch (markdown-view teardown,
  status-strip-lsp-menu, application-settings) — confirmed present on `main`.

## Test repository

A generator builds a repo exercising every path (merge graph, branches, tags,
stashes, ahead/behind via a bare remote, and a dirty tree with
staged/unstaged/untracked/rename/delete). It currently lives in the **session
scratchpad** as `make-git-test-repo.sh` (not yet committed — consider moving to
`scripts/` if it should be kept).

```sh
bash make-git-test-repo.sh [target-dir]   # default /tmp/onix-git-test ; wipes + recreates
# then "Open Repository" -> <target-dir>/repo
```

## Return prompt (paste to resume)

> Resume the git integration on branch `feature/git-integration`. Read
> `docs/source-control-integration.md` first. Seven slices are done (read-only, local
> mutations, workspace decorations, branch ops, **network fetch/pull/push**, **ribbon
> cross-view + unified tab dedup + workspace commit panel**, and **docked agent +
> terminal panels** — slices 5–7 may still be uncommitted in the working tree). Next up
> is **discard changes** (per-file revert with a destructive confirm dialog), then
> reconcile GitHub tickets #96–99. Keep the build, electron `tsc`, `eslint .`, and
> `ng test` green (3 known unrelated failures).
