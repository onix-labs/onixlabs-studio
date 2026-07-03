# Questionable docs — remaining for review

Residue from consolidating the old `docs/*.md` into `agents.md`. `agents.md` is kept high-level
(architecture + guardrails); status and TODOs go to GitHub issues, not the guide. Two items below
still need your call. Once resolved, this file is deleted.

## Resolved

- **AI-agent "forward-looking" items** — #142 / #112 / #113 / #108 / #109 are all **closed**; that
  work shipped and `agents.md §5` describes it. Discarded.
- **Agent v0.5+ hardening** (write-confinement, audit log, per-tool policies) → new issue **#190**.
- **Git discard-changes** → new issue **#188**. **In-app git auth** → new issue **#189**.
- **`WorkspaceGit` spec gap** — covered by the existing Quality epic **#129** (spec-coverage audit).
- **Git slice status / "not yet committed"** — shipped; transient. Discarded (git history).
- **`arch-refactor.md` plan-vs-as-built corrections** — verified: electron output stays at
  `dist-electron/electron/`, `FeatureDescriptor` is `{ type, view, ribbon?, documentPanel?, chrome? }`,
  the dock uses a declarative `DockBlueprint` via `DOCK_BLUEPRINT`. `agents.md` is accurate. Discarded.
- **Migration procedure / progress log** — spent; preserved in git history. Discarded.
- **Git issues #96–#99** — **#97/#98/#99 closed as delivered**; epic **#96** kept open with a
  "delivered" status + remaining work repointed at **#188/#189**.

## Open — for you to take one by one

### 1. `make-git-test-repo.sh` test-repo generator

A throwaway script that built a rich fixture repo (merge graph, branches, tags, stashes, ahead/behind
via a bare remote, a dirty tree with staged/unstaged/untracked/rename/delete) lived in a session
scratchpad and was **never committed** — it no longer exists.

**Decision needed:** worth recreating as a committed dev-tooling script (e.g. `scripts/`, or an issue
under the Quality epic), or drop it? Recreating from scratch is cheap when next needed.
