# Source Control Integration — status & handoff

Working notes for the git/VCS integration on branch **`feature/git-integration`**.
Last updated after slice 4 (branch ops).

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

(These sit on top of the earlier source-control **scaffold** + **dock rehost** commits:
`4a50a53`, `a770ead`, `9482b35`.)

## Architecture map

**Main process** — `src/electron/git-manager.ts` (`GitManager`): `execFile git`,
`isSafeOperand`/`confinedPaths` guards, **refcounted** opened-roots `Map`. Channels
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

## Remaining work (~2 meaty + 2 small)

1. **Network (slice 5, meaty, riskiest)** — `fetch` / `pull` / `push`. Auth/credentials,
   remotes, and conflict/failure handling. Backend ops + provider + Repository +
   ribbon wiring (Pull/Push/Fetch are currently **no-ops** in
   `source-control-view.ts` `registerCommandHandler`).
2. **Panels (slice 6, smaller)** — agent panel on SC tabs + **terminal panel on both**
   tabs. Both are dock hosts, so these are new blueprint panels reusing the code tab's
   docked agent/terminal infra.
3. **Discard changes (follow-up)** — per-file revert in the commit panel's Changes
   group; **needs a confirm dialog** (destructive). Handle tracked (`git restore
   --staged --worktree`) vs untracked (delete) cases.
4. **Workspace ribbon git ops (follow-up)** — branch/commit/push/pull surfaced in the
   **directory tab's** ribbon. **Gated on the user's ribbon ideas** (he has some);
   overlaps with the network slice.

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
> `docs/source-control-integration.md` first. Four slices are committed
> (read-only, local mutations, workspace decorations, branch ops). Next up is
> **slice 5 — network (fetch/pull/push)**: add the ops to `GitManager` (+ channels,
> preload, `SourceControlApi`), the provider, and `Repository`, then wire the
> ribbon's Fetch/Pull/Push (currently no-ops in `source-control-view.ts`). Mind
> auth/credentials and surface failures via `GitRunResult`. Keep the build, electron
> `tsc`, eslint, and `ng test` green (3 known unrelated failures). Before building,
> ask me whether to do network first or the agent/terminal panels, and whether I
> have ribbon ideas to fold in.
