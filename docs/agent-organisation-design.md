# Agent organisation — design

> The design note for epic #788 (phase P0, #789), written 2026-10-02 against `main` at `762cb4ff`.
> It lives on the spike branch because the spike may be abandoned. If the spike merges, this note
> moves to the wiki as `Decision-Agent-Organisation` and leaves `docs/`.

## 1. Purpose

Today a Studio user drives **one agent per project**, and Mission Control is a flat list of those
agents. This epic lets the user run an **organisation**: many projects and, within each project, many
branches worked in parallel by a **hierarchy of named agents**. A Principal Product Owner is handed an
initiative and supervises Product Owners. Each Product Owner owns an epic and supervises the engineers,
testers and QA who deliver its features.

This note fixes the model every later phase builds on. It is a spike: the model will move as we learn,
and the note is updated in the same PR as any change to it.

## 2. Decisions already taken

| Decision                                                                                                    | Source                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The work-item hierarchy comes from **GitHub sub-issues** for now, behind a seam so other sources can follow | Matthew, 2026-10-02                                                                     |
| The **branch policy is user-configurable**: stacked or flat                                                 | Matthew, 2026-10-02                                                                     |
| **Principal Product Owners are real agents**; the user is not the root of the tree                          | Matthew, 2026-10-02                                                                     |
| **Studio owns orchestration**, rather than wrapping Claude Agent Teams                                      | #429 (Agent Teams is Claude-only and CLI-version-sensitive; Studio must enforce limits) |
| **Work items are the nodes; agents are an attribute of a node**                                             | #429                                                                                    |
| Agent write confinement is a hard boundary at **every** level                                               | `docs/agents.md`, non-negotiable 4                                                      |

## 3. What exists today

The seams this builds on, and the gaps it has to fill.

| Area            | What exists                                                                                                                                                                              | Gap                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Forge           | `ForgeProvider` (`src/shared/electron/contributions/forge/forge-provider.ts`), REST with ETag cache and rate-limit ledger (`forge-budget.ts`), `ForgeRepository` signals in the renderer | No hierarchy fields mapped; a single page of 50 issues; no writes except workflow re-run and cancel |
| Agents          | `Agent` + `AgentConversation` per view; `AgentHosts` registry; `AiManager.run` in main with trusted `AiBridgeScope` stamping                                                             | An agent exists only while its view is mounted; no agent can start another                          |
| Tools           | Core tools assembled in `toolsForSurface` (`ai-sdk-stream.ts`), offered to harnesses through `describeOffer` / `invokeTool`, gated and audited by `gated(...)`                           | No organisation tools                                                                               |
| Worktrees       | Container of full clones (`WorktreeOperations.addCheckout` runs `git clone`), per-checkout `DirectoryView`                                                                               | A checkout gets an agent only when its sub-view mounts                                              |
| Roles           | Prompt profiles (`PromptProfiles`, scoped by surface and language) and skills (`SkillLibrary.offer`), applied in core by `prompt-layers.ts`                                              | No notion of a role or an identity                                                                  |
| Mission Control | `MissionControlView` tiles over `AgentHosts.hosts`, rail via `ListView`, in-memory state                                                                                                 | One flat level, keyed by host, not by work item                                                     |

Two facts from the GitHub REST API shape the design. Every issue object already carries
`parent_issue_url`, `sub_issues_summary {total, completed, percent_completed}`,
`issue_dependencies_summary {blocked_by, blocking, …}` and `author_association`. So **one paginated
issue listing is enough to build the whole tree**. There is no call per parent, and no GraphQL (which
would lose the ETag cache and its free 304s).

## 4. The model

### 4.1 Work items

```ts
interface WorkItem {
  readonly key: string; // source-qualified, e.g. "github:onix-labs/onixlabs-studio#788"
  readonly number: number;
  readonly title: string;
  readonly level: WorkItemLevel; // 'initiative' | 'epic' | 'feature' | 'task'
  readonly state: 'open' | 'closed';
  readonly parentKey: string | null;
  readonly childSummary: { total: number; completed: number };
  readonly blockedBy: number;
  readonly labels: readonly string[];
  readonly assignees: readonly string[]; // forge users; agents are assigned in Studio (§4.3)
  readonly authorTrusted: boolean; // from author_association, see §8
  readonly url: string;
  readonly updatedAt: string;
}
```

- **`WorkItemSource`** is the seam: `tree(project)`, `children(key)` (for closed children fetched when
  a node expands), and later the writes (§6.4). GitHub is the first source and is built on
  `ForgeProvider`. Linear, Jira or a local `.studio/` plan file can implement it later.
  - _As built in P1:_ the read is `ForgeProvider.listWorkItems` (every open issue, paginated oldest
    first up to 10 pages of 100, with parent and child summary), and the tree is built in the
    renderer by `buildWorkItemTree`. The seam stays a forge method until a second source exists, so
    its shape comes from two real implementations rather than one guessed one.
- **Level** is resolved by a configurable mapping: the GitHub issue `type` when the organisation uses
  issue types, otherwise labels (`initiative`, `epic`, `feature`), otherwise depth. This repository
  uses the `epic` / `feature` labels today.
- **Progress is derived, never reported.** An open leaf is 0; closing it completes it. A parent is
  (closed children + the progress of each open child) ÷ all children, where closed children are known
  only from `sub_issues_summary` because only open issues are listed. Agents cannot
  write a percentage.

### 4.2 Agents and roles

```ts
interface Role {
  readonly id: string; // 'principal-product-owner', 'product-owner', 'engineer', …
  readonly title: string;
  readonly brief: string; // the role's system-prompt layer
  readonly skills: readonly string[]; // skill names offered on top of the surface's
  readonly isolation: 'checkout' | 'patch' | 'readonly';
  readonly supervises: readonly string[]; // role ids it may dispatch to; empty = a leaf worker
}

interface OrgAgent {
  readonly id: string; // stable UUID
  readonly name: string; // "Ada" — what the user calls them
  readonly roleId: string;
  readonly avatar: AvatarSpec; // generated monogram and colour; no images in the spike
}
```

- Built-in roles: Principal Product Owner, Product Owner, Engineer, Tester, QA, Reviewer. They ship as
  **editable data**, not code.
- The role brief is a new prompt layer, applied in core alongside prompt profiles through
  `withSystemPromptExtra`. No protocol change is needed: layers already compose in core.
- **Isolation** decides what an agent touches. `checkout` writes in its work item's checkout.
  `readonly` reads and calls organisation tools only (all supervisors). `patch` proposes a diff that
  the checkout's writer applies (testers or reviewers sharing a feature's checkout).

### 4.3 Assignment

An **assignment** binds one agent to one work item. Supervisors are assigned to initiatives and epics,
workers to features and tasks. An agent holds one assignment at a time in the spike. Assignments are
Studio state, not forge assignees, because agents aren't forge users. Mirroring them to GitHub (a
label or a comment) is a later option.

### 4.4 Where the state lives

| State                                             | Where                                                                        | Why                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| Roles, roster, branch policy, limits              | `.studio/organisation.json`, committed                                       | Team-level choices that should travel with the repository |
| Assignments, dispatches, reports, messages, spend | `userData/organisation/<project-id>/`                                        | Per-user runtime state                                    |
| Each agent's transcript                           | `AgentConversationStore`, under a new context kind `organisation:<agent-id>` | Reuses persistence, search and the conversation list      |

The main process is the authority. A new **`OrganisationManager`** in main owns the state, validates
every change and enforces the limits (§6.3). The renderer is untrusted (non-negotiable 3) and only
renders the state and hosts sessions.

## 5. Running agents that no view has mounted

This is the main structural change. Today an `Agent` lives in a view's injector and dies with it. A
dispatched Product Owner, or the engineer under it, has no view.

**Spike approach:** a root-level renderer service, `OrgAgents`, owns one `Agent` + `AgentConversation`
per named agent, in a child injector per agent. This is the same pattern as
`MissionControlView.injectorFor`, lifted to the root. Each one:

- provides `AGENT_WORKSPACE_ROOT` = the agent's checkout (or the container root for `readonly` agents)
  and an `AGENT_RUN_OWNER` of `organisation:<agent-id>`;
- registers with `AgentHosts`, so Mission Control, permission prompts, remote control and _stop all_
  work unchanged;
- is created when main dispatches to it and disposed when its assignment ends.

Main never trusts the renderer to start the right turn. `OrganisationManager` records the dispatch,
then asks the renderer over a bridge capability to start it. `AiManager.run` checks that the run's
`agentSessionId` and `workspaceRoot` match the dispatch main recorded, and refuses the turn otherwise.

**Migration path:** epic #769 moves harness ownership into a background agent host. When that lands,
`OrgAgents` shrinks to a view over host sessions and the organisation keeps running with Studio
closed. Nothing else in the organisation model changes, because only `OrgAgents` starts organisation
turns.

## 6. Supervision

### 6.1 Tools

Core-defined organisation tools, offered by `toolsForSurface` and gated and audited by `gated(...)`
like every other tool:

| Tool             | Who         | Does                                                                                                                   |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `org_work_items` | supervisors | Reads the subtree under the agent's assignment                                                                         |
| `org_dispatch`   | supervisors | Assigns a work item to a new or existing agent of an allowed role, with a brief. Prepares the branch and checkout (§7) |
| `org_status`     | supervisors | Reads the state of the agent's direct reports                                                                          |
| `org_message`    | everyone    | Sends a message to a direct report, the supervisor, or the work item's channel                                         |
| `org_report`     | everyone    | Reports up in the fixed shape (§6.2)                                                                                   |
| `org_escalate`   | everyone    | Raises a question for the user. It lands in the _Needs you_ inbox and the agent waits                                  |

The tool set depends on the role, not only on the surface. A supervisor gets organisation tools plus
read-only workspace tools. A worker gets the workspace surface plus `org_message`, `org_report` and
`org_escalate`. A supervisor can reach **only its own subtree**. Main checks every target against the
assignment tree, because the model's word is not enough.

### 6.2 Reports

```ts
interface OrgReport {
  readonly done: readonly string[];
  readonly inProgress: readonly string[];
  readonly blocked: readonly string[];
  readonly risks: readonly string[];
  readonly decisionsNeeded: readonly string[];
}
```

Reports are structured, so the Project Overview can roll them up without an LLM summarising another
LLM's summary. `decisionsNeeded` entries surface in _Needs you_.

### 6.3 Waking, not polling

A supervisor sleeps between turns. When a direct report finishes a turn, reports, escalates or fails,
`OrganisationManager` queues the event. If the supervisor is idle, the queue starts a turn with the
coalesced events as its prompt. If the supervisor is mid-turn, the events are steered in, since live
sessions support steering. Supervisors cost nothing while their teams work.

### 6.4 Limits Studio enforces

The model proposes and Studio enforces. Defaults are configurable in `.studio/organisation.json`:

| Limit                         | Default               | When hit                                                |
| ----------------------------- | --------------------- | ------------------------------------------------------- |
| Depth below the root agent    | 2 (PPO → PO → worker) | Dispatch refused, with the reason returned to the model |
| Direct reports per supervisor | 5                     | Dispatch refused                                        |
| Active agents per project     | 12                    | Dispatch queued                                         |
| Writers per checkout          | 1                     | Dispatch refused; use `patch` isolation                 |
| Token spend per subtree       | none until P5         | The subtree pauses and _Needs you_ gets an entry        |

**Forge writes need a decision from Matthew before P3.** Letting a PPO create sub-issues, comment, or
open pull requests is an outward-facing write to GitHub on the user's account. The proposal is: the
spike ships with forge writes as **ask** by default, every one shown in _Needs you_ before it happens,
and _allow_ is a per-project setting, never a per-action override.

## 7. Git

### 7.1 Branch policy

```ts
type BranchPolicy =
  | { kind: 'stacked' } // feature ← epic ← initiative ← base; PRs target the parent's branch
  | { kind: 'flat' }; // every work item branches from base; PRs target base
```

- Branch names: `<level>/<number>-<slug>`, for example `epic/788-agent-organisation`. They are derived
  and stable, so a branch can always be traced back to its work item.
- **Stacked:** children merge into their parent's branch with **merge commits, never squash**. A
  squash orphans every branch stacked behind it. Only the final merge to base may squash.
- Branch creation is a local `git` operation in the work item's checkout. Pushing follows the same
  rule as forge writes (§6.4).

### 7.2 Checkouts

- **One checkout per branch-owning work item, and one writer at a time** (§6.4). Supervisors don't own
  checkouts; they read the container's base checkout.
- Checkouts reuse the worktree container (`WorktreeOperations.addCheckout`), called from main by
  `OrganisationManager`. No view needs to mount.
- **Every checkout must be registered as an open workspace root** before an agent runs in it. That is
  what write confinement checks, so the boundary holds without a new mechanism.
- **Cost at scale:** `git clone` from a local path hardlinks the object store, so a clone's git
  footprint is small. The real cost is installing dependencies per checkout (`node_modules`). P3
  measures this on onixlabs-studio before choosing between full clones (today) and `git worktree`.

## 8. Security

- **Issue bodies are untrusted input.** The repository is public, so anyone can file an issue that a
  PPO reads. Work items whose `author_association` isn't `OWNER`, `MEMBER` or `COLLABORATOR` are
  marked untrusted. Agents see them fenced as quoted data, and a supervisor can't dispatch one without
  a _Needs you_ approval.
- **Confinement:** every agent runs with its checkout (or the container) as its workspace root. The
  existing checks refuse writes outside it, at every level of the hierarchy.
- **The renderer is untrusted:** organisation state changes go through validated IPC handlers in main.
  Dispatch-to-run binding is checked in `AiManager.run` (§5).
- **Audit:** organisation tools are recorded in the existing agent audit log through `gated(...)`.

## 9. Views

All views are faces of one Mission Control, selected from its ribbon:

| Face        | Phase | What it shows                                                                                                                                                         |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hierarchy   | P1    | Tree-table of work items: level, state, branch, derived progress, agents, updated. Virtualised. Built on `app-tree-view`, since `app-table` has groups but no nesting |
| Agents      | today | The existing per-host tiles                                                                                                                                           |
| Chat        | P4    | A channel per work item, a direct-message thread per agent                                                                                                            |
| _Needs you_ | P5    | One inbox across projects: permission prompts, escalations, forge-write approvals, failed merges                                                                      |
| Overview    | P5    | One card per project with roll-ups and integration health                                                                                                             |
| Board       | P6    | Kanban by level, grouped by parent                                                                                                                                    |

**Performance:** Mission Control is mount-all/hide-inactive and the app is zoneless. Faces render only
while visible, as the tiles already do, and organisation state reaches the renderer as coalesced
snapshots, not per-token events. Forge polling uses the ETag cache, which keeps the 304s free.

## 10. Housekeeping found along the way

- The ESLint feature-isolation rule (`eslint.config.js`) didn't list `mission-control`, `api-explorer`,
  `binary`, `containers`, `image`, `model-manager`, `plugin-manager` or `system-monitor`, and named a
  `repository` feature that no longer exists. P1 derives the list from `src/features` instead, so it
  can't drift again. None of the eight newly covered features was importing a sibling.

## 11. Phases

| Phase   | Builds                                                                                       |
| ------- | -------------------------------------------------------------------------------------------- |
| P0 #789 | This note                                                                                    |
| P1 #795 | GitHub hierarchy read (pagination, hierarchy fields); open-projects registry; Hierarchy face |
| P2 #790 | Roles, roster, assignment; `OrgAgents` hosting                                               |
| P3 #791 | `OrganisationManager`, organisation tools, waking, limits, branch policy and checkouts       |
| P4 #792 | Chat face                                                                                    |
| P5 #793 | _Needs you_ and Overview; spend                                                              |
| P6 #794 | Board face                                                                                   |

## 12. Open questions

1. **Forge writes** (§6.4): ask-by-default with a per-project allow. Needs Matthew's call before P3.
2. **Checkout model** (§7.2): full clones or `git worktree`, decided by P3's measurement.
3. **One assignment per agent:** this keeps the spike simple, but may be too strict for a reviewer who
   looks across features.
4. **Mirroring assignments to GitHub:** none in the spike.
5. **Running with Studio closed:** waits on #769.
