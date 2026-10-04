# Agent teams — design

Epic #788. Supersedes the agent-organisation spike (P0–P8), which was retired on 2026-10-04.

## 1. Purpose

Let the user act as the **product owner of a team** rather than an engineer supervising one agent at
one desk: hand a supervising agent an epic and have its sub-tasks worked in parallel, each on its own
branch, while the user reviews outcomes rather than steering every step.

The single-agent workflow stays the default and stays unchanged. A team is something the user asks
for, not something every workspace becomes.

## 2. Decisions taken

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **One conversation.** The user talks to the lead only. No group chat, no private DMs, no agent-to-agent conversation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D2  | **Provider-agnostic.** Lead and workers may be any provider plugin that meets the requirements in §6. Nothing depends on a provider's own subagents or teams.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D3  | **Studio hosts the workers.** No standard for lead → worker delegation exists (§11), so Studio builds the team layer, using MCP for the lead's tools and borrowing state names from MCP Tasks / A2A.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D4  | **Workers coordinate through a board and the lead only.** Workers do not message each other.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D5  | **Isolation is a seam.** Studio's existing worktree containers first (#351: each checkout a full clone with its own view and agent); containers later (through the container-engine plugins, #592); remote workers possible. A worker's contract is identical on every backend.                                                                                                                                                                                                                                                                                                                                                                  |
| D6  | **Workflow policy is the user's.** Branch targets (main, epic, sprint branches), PR shape and who merges (the user or agents) are configured — prompt layers for policy, settings for capabilities — never decided by Studio.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D7  | **Team host first, ACP after.** The team host is built on the existing harnesses; an ACP harness plugin follows to widen the provider set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D8  | **Codex moves to the app-server — later.** `codex-harness` switches from `@openai/codex-sdk` to the Codex app-server, so Codex can route approvals and take Studio's tools. Deferred on 2026-10-04: the spike is proven with Claude first, and does not touch the Codex plugin.                                                                                                                                                                                                                                                                                                                                                                  |
| D9  | **Unattended workers are opt-in.** A provider that cannot route permission requests to Studio may work only when the user enables it for that provider; such workers are labelled _unattended_, write only inside their isolation root, and never push or merge themselves.                                                                                                                                                                                                                                                                                                                                                                      |
| D10 | **First version: Claude lead and Claude workers** (narrowed 2026-10-04 from Claude and Codex workers). Nothing in the team host is Claude-specific; Codex joins when D8 lands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D11 | **Workers are checkouts of a worktree container** (2026-10-04, while building). Studio already has the container model of #351 — each checkout a full clone on its own branch, with its own kept-alive view, documents, terminals and agent — and its deferred orchestrator (#367) is this design's lead. A worker is a new checkout whose own agent is briefed, rather than a `git worktree` under `.studio/worktrees` hosted headlessly as the retired spike did. It matches "every engineer has their own machine" better, keeps one worktree concept in the product, and lets the user step into any worker's checkout and see what it sees. |

## 3. How it plays out

**A one-off bug.** "Fix #812." The lead does it itself, exactly as the workspace agent does today.
Nothing on this page is involved.

**An epic, followed step by step.** "Work through #790 and stop after each sub-task." The lead does
the sub-tasks itself, one at a time, pausing between them. Still one agent; this is an instruction,
not a feature.

**An epic, in parallel.** "Take #788 and run the sub-tasks in parallel."

1. **The lead plans and the user approves the plan.** The plan names each task, what it depends on,
   the areas of the code it will touch, and the order its work should land in. The approval is the
   user's bound on the team; overlap between tasks is designed out here, before anyone starts.

   ```
   #789 settings schema   → src/settings/**          no deps
   #790 store migration   → src/store/**             after #789
   #791 UI panel          → src/features/panel/**    after #789
   #792 docs              → docs/**                  anytime
   #793 e2e tests         → e2e/**                   last
   ```

2. **The lead starts workers.** Each gets one task, its own isolated checkout and its own branch. An
   _in flight_ list appears under the conversation:

   ```
   ● #789  settings schema   Claude   agent/789-settings   working · 2m ago
   ● #792  docs              Codex    agent/792-docs       needs you ⚠
   ○ #790  store migration   Claude   —                    waiting on #789
   ```

   Selecting a row opens that worker's transcript, read-only.

3. **Anything a worker needs from the user arrives in the one conversation** as a card — a permission
   request, a question — and is answered there. The lead never answers on the user's behalf.

4. **Workers finish by committing, pushing and opening a PR** (as the user's policy and capability
   settings allow), and report completion. The lead reviews the result and reports to the user. The
   user reviews and merges — or the lead does, if the user's policy says so.

The rendering of Claude's background subagents in today's agent panel (one conversation; compact
rows for delegated work, each expandable) is the visual reference. The difference is that Studio, not
a provider, produces the rows, so they look and behave the same for every provider.

## 4. The model

### 4.1 Lead

The workspace's own agent. It becomes a lead simply by being offered the team tools (§5) — there is
no promotion, roster or role. A lead may also do work itself in the user's checkout.

### 4.2 Workers

A worker is an ordinary agent session that Studio hosts:

- one **task** — free text, optionally linked to a forge issue (linking is a convenience, not a
  requirement);
- one **provider** and model;
- one **isolation root** (a worktree today) on one **branch**, cut from a **base** chosen by the lead
  according to the user's policy;
- a **brief**: the task, the plan it belongs to, and the conventions in the repo's `AGENTS.md`.

### 4.3 States

Named after MCP Tasks / A2A so that a future adoption of either is a mapping, not a redesign:

| State            | Meaning                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `queued`         | Waiting on other workers (`after`) or on a concurrency limit        |
| `starting`       | Preparing its checkout and session                                  |
| `working`        | Running a turn                                                      |
| `input_required` | Waiting on the user (a permission or a question)                    |
| `idle`           | Between turns, task not complete — the lead can instruct it further |
| `completed`      | Reported done, with a summary and (optionally) a PR                 |
| `failed`         | Its session failed or it reported it cannot finish                  |
| `cancelled`      | Stopped by the lead or the user                                     |

### 4.4 The board

A per-team, Studio-owned log. Each entry has an author, a time, a kind and short text:

- `claim` — "I'm changing `src/store/**`";
- `change` — something others depend on: "renamed `Settings.theme` to `Settings.appearance`; rebase
  onto `agent/789-settings`";
- `blocked` — what it is waiting for;
- `note` — anything else.

Workers append their own entries and read everyone's. The lead reads all and may post. The board is
not a chat: no mentions, no replies, no wakes.

### 4.5 Waking the lead

The lead is woken only when a worker reaches `completed` or `failed`, with one message per event
naming the worker and its summary. `input_required` goes to the **user**, not the lead (and is visible
to the lead through `worker_status`). Nothing else wakes anyone.

## 5. Tools

Defined once in core and offered through the existing provider-neutral tool path (the harness
`tools` / `tool` requests): Claude receives them as an in-process MCP server, the AI SDK harness as
native tools. Leads on harnesses that cannot ask for Studio's tools (ACP agents, the Codex app-server)
reach the same tools through a Studio MCP endpoint (phase T6).

**Lead tools**

| Tool              | Input                                                                                       | Result                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `start_worker`    | `task`, `title?`, `issue?`, `base?`, `branch?`, `provider?`, `model?`, `after?: workerId[]` | worker id, branch, state                                   |
| `worker_status`   | `workerId?`                                                                                 | state, branch, last activity, pending request, summary, PR |
| `instruct_worker` | `workerId`, `text`                                                                          | delivered / refused (worker busy or finished)              |
| `stop_worker`     | `workerId`                                                                                  | final state                                                |
| `read_board`      | `since?`                                                                                    | entries                                                    |
| `post_to_board`   | `kind`, `text`                                                                              | entry                                                      |

**Worker tools**

| Tool            | Input                     | Result                        |
| --------------- | ------------------------- | ----------------------------- |
| `read_board`    | `since?`                  | entries                       |
| `post_to_board` | `kind`, `text`            | entry                         |
| `complete`      | `summary`, `pullRequest?` | ends the task; wakes the lead |
| `fail`          | `reason`                  | ends the task; wakes the lead |

Questions to the user go through the provider's own ask-the-user tool, or Studio's `ask_user`; both
already reach Studio as requests.

## 6. Providers

| Need                                         | Lead     | Worker                                                                 |
| -------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| Accepts Studio's tools (tool request or MCP) | required | required (board, `complete`)                                           |
| Long-lived session, multi-turn               | required | required                                                               |
| Runs in a working directory Studio chooses   | —        | required                                                               |
| Edits files and runs a shell                 | —        | required                                                               |
| Routes permission requests to Studio         | required | required, unless the user has opted the provider in as unattended (D9) |
| Cancellable                                  | required | required                                                               |

Today's harnesses:

| Harness                   | Lead                                            | Worker                    | Work needed                                                                                                   |
| ------------------------- | ----------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Claude (`claude-harness`) | ✅                                              | ✅                        | set `permissionMode` explicitly — since SDK 0.3.286 an unset mode can start in `auto`, bypassing `canUseTool` |
| Codex (`codex-harness`)   | ❌ (`approvalPolicy: 'never'`, no Studio tools) | unattended only           | move to the app-server (D8): approvals over JSON-RPC, MCP tools, resume, interrupt                            |
| AI SDK (`ai-sdk-harness`) | ❌ (stateless)                                  | ❌ (no shell, no history) | none planned                                                                                                  |

Providers' own subagents and teams are not used. Claude's Agent Teams do not spawn in SDK sessions
(per its docs, 2026-10-04 — contradicting spike #429, to be re-tested); Claude's worktree subagents
branch from the default branch and their permission grants persist into the lead's session; other
providers differ again.

## 7. Isolation

### 7.1 The seam

```
IsolationBackend
  prepare(task, base, branch) → { root, branch }
  dispose(root, { keepBranch })
  list() → roots
```

`worktree` ships first; `container` and `remote` follow without changing the team host, the tools or
the UI.

### 7.2 Worktrees

> **Superseded by D11** for the spike: workers are checkouts of a worktree container (full clones),
> not `git worktree`s. As built, see §16. The points below on bases, tracking and never removing
> unpushed work still hold.

- Created under `<project>/.studio/worktrees/<dir>`, ignored by git and by the file watcher.
- The branch is cut from the base the lead names; Studio never chooses a base on its own.
- Created with `--no-track`; pushing sets the upstream.
- Removed (`git worktree remove` + `prune`) when the task is completed, failed or cancelled and its
  branch is pushed or the user discards it. Unpushed work is never removed silently.
- Codex's `workspace-write` sandbox may make a linked worktree's gitdir read-only, preventing commits.
  To be tested in T5; if confirmed, the gitdir is added to its writable roots (or Studio commits for
  it).

### 7.3 Containers and remote (later)

A container worker is the same contract with the provider running inside the container, the
repository cloned in, and push credentials scoped to that branch. Remote workers would ride ACP's
HTTP transport or A2A (§11). Neither is designed in detail here.

## 8. Policy and enforcement

**Policy** — how the user's team works — lives in the prompt layers (system and user prompts):
branch naming, where PRs target, review expectations, who merges. Studio ships no opinion.

**Capabilities** — what agents are _able_ to do — are settings, enforced by Studio:

- whether agents may push; whether they may open PRs; whether they may merge, and into which branch
  patterns; other forge writes;
- which providers may work unattended (D9);
- concurrency (workers running at once) and spend caps;
- confinement: a worker writes only inside its isolation root.

A prompt can ask an agent to follow policy; only a capability can stop it breaking one. Confinement
is a hard boundary, overridable only through configuration, never per action.

## 9. Security

- **Main validates every run's root.** Today `AiManager` accepts a renderer-supplied `workspaceRoot`
  after a shape check only. A run's root must be an open workspace root or one of its isolation roots.
  (Pre-existing gap; fixed in T1.)
- **Caller identity is stamped in main** (`agentSessionId` in `AiBridgeScope`); a tool call cannot
  claim to be another agent. A worker's identity resolves through its isolation root, not the project
  root.
- **Only the user answers permission requests.** The lead sees that a worker is waiting; it cannot
  grant on the user's behalf. A grant to one worker does not extend to the lead or other workers.
- **Untrusted input.** A task linked to an issue whose author is outside the repo's collaborators is
  held for the user's approval before a worker starts.
- **Unattended workers** never hold push credentials; Studio pushes on their behalf, within the
  capability settings.

## 10. UI

- **The workspace agent panel** keeps its single conversation. When the lead has workers, an _in
  flight_ list sits beneath the transcript: title, provider, branch, state, last activity, and a
  _needs you_ marker.
- **A worker's transcript** opens read-only from its row. The user does not converse with workers
  (D1); to redirect one, they tell the lead.
- **Cards** for workers' permission requests and questions appear in the conversation, attributed to
  the worker, and are answered in place.
- **Stop** on a row stops that worker; stopping the lead's turn does not stop workers.
- **Mission Control** stays the cross-workspace fleet view. Whether a lead's workers appear there as
  individual agents or under their lead is an open question (§15).

## 11. Standards

| Standard                        | Used for                           | Notes                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MCP**                         | The lead's and workers' team tools | State names borrowed from the Tasks extension; no client implements Tasks yet                                                                                                                                    |
| **ACP** (Agent Client Protocol) | Hosting third-party agents (T7)    | One harness plugin reaches Gemini, Goose, Cline, Cursor, Copilot, and Claude/Codex through adapters. Its draft Subagent Sessions RFD (`unstable_subagents`) is agent-spawned, so it is mirrored, not depended on |
| **A2A**                         | Possibly, remote workers           | Stable (v1.0.1) but barely adopted by coding agents                                                                                                                                                              |
| **AGENTS.md**                   | Worker briefs                      | Repo conventions reach every worker the same way                                                                                                                                                                 |

## 12. What exists, and what must change first

On `main` today:

- Provider-neutral tool offering (`harness-tools.ts`, `describeOffer` / `invokeTool`).
- Hosted sessions with a per-run root, resume, abort, `panic`, `task.stop`.
- The app-wide `AgentRequests` registry, through which every hosted session's prompts already flow.

Gaps the team would hit:

| Gap                                                                    | Where                                   | Fix                                                                                                           |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A ninth live session evicts the least-recently-used one, even mid-task | `ai-manager.ts` `MAX_LIVE_SESSIONS = 8` | Workers' sessions are pinned while not terminal; the concurrency cap and the live-session cap are one setting |
| Run roots are not validated                                            | `AiManager.isRunRequest`                | §9                                                                                                            |
| No caller identity in the bridge scope                                 | `AiBridgeScope`                         | Add `agentSessionId`, stamped in main                                                                         |
| Codex cannot lead or ask                                               | `codex-harness`                         | D8                                                                                                            |
| Spend is unknown for providers that report tokens only                 | spend tracking                          | Estimate from a price table, marked as an estimate                                                            |

## 13. Carried forward from the spike

The spike's branches were deleted on 2026-10-04 without being merged. Its last commit was
`c1e275c3` (local only; recoverable until git garbage-collects it); P0–P2 remain reachable through
PRs #796–#798. Worth porting, each rewritten for this model:

- `organisation-checkouts.ts` — main-side `git worktree` creation and listing, validated and confined
  (needs remove/prune; drop the issue-number coupling).
- `OrgCheckouts` — flat or stacked branch policy.
- `OrgAgents` — hosting an ordinary session per agent rooted at its checkout; registration with
  `AgentRequests` / `AgentHosts`.
- `OrgSpend` — spend caps.
- `agentSessionId` in `AiBridgeScope`.
- The scan behind `waitingOn()` — finding a session's pending requests.
- From `OrgSupervision`: limit checks and the untrusted-author hold only.

Retired: the GitHub sub-issue hierarchy, board and overview faces; the roster and roles; the group
chat, DMs, `org_message`; the wake and catch-up machinery.

**Lessons kept:**

- Every phase's acceptance includes "the product still composes": a reachability spec that walks from
  the app's roots through `.ts` and `.html` and fails on any shipped surface nothing mounts. The spike
  ended with four fully specced surfaces the app could not reach.
- One end-to-end manual walk-through (open a project, run a parallel epic, hit a permission request,
  hit an untrusted issue, answer each) before anything merges.
- Agent-to-agent conversation produced cost, not value: the spike's test run spent 47 minutes and
  produced no report. Coordination stays structural (plan, board, PRs).

## 14. Phases

| Phase  | Scope                                                                                                                      | Depends on              |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **T0** | This note                                                                                                                  | —                       |
| **T1** | Foundations: run-root validation in main; `agentSessionId`; session pinning and one concurrency setting; reachability spec | —                       |
| **T2** | Isolation seam + worktree backend (create, list, remove, prune); branch from the lead's base                               | T1                      |
| **T3** | Team host: workers, states, board, lead wakes, tools; capability settings (push / PR / merge / unattended / caps)          | T1, T2                  |
| **T4** | UI: in-flight list, worker transcript, cards in the lead's conversation                                                    | T3                      |
| **T5** | Codex harness on the app-server: approvals, Studio tools, commit-in-worktree test                                          | — (parallel with T1–T4) |
| **T6** | Studio MCP endpoint (stdio / HTTP) for leads that cannot request Studio's tools                                            | T3                      |
| **T7** | ACP harness plugin                                                                                                         | T6                      |
| Later  | Container backend; remote workers                                                                                          | T2                      |

The first usable release is T1–T5: a Claude lead with Claude and Codex workers in worktrees.

## 15. Open questions

1. **Persistence across restart.** Do workers survive quitting Studio (#769, persistent agents), or
   are running workers stopped and resumable on next launch?
2. **Mission Control.** Workers as individual agents, or grouped under their lead?
3. **Board persistence.** Kept per team for the life of the epic, or discarded when the team ends?
4. **The lead's own edits.** May the lead edit the user's checkout while workers run, or is it
   confined to planning and review once a team exists?
5. **Worker-to-lead questions.** Is `instruct_worker` enough in one direction, or does a worker need a
   way to ask the lead (rather than the user) something mid-task?
6. **Agent Teams in SDK sessions.** Re-test to settle the contradiction with spike #429.

## 16. As built in the spike (2026-10-04)

Branch `spike/788-agent-teams`. Claude only (D10); `plugins/codex-harness` untouched.

**Where a team lives.** In a worktree container (#351). Promote a repository first (ribbon ▸
Promote); every checkout's agent is then a potential lead, offered the lead's tools. A team is one per
container tab, held in memory for the tab's life.

**What a lead does.** `start_worker` (gated: the user is asked, through the ordinary permission card,
before each worker starts) clones a new checkout on the worker's branch — from the named base, read
from the clone's source as `origin/<base>`, created `--no-track` — opens that checkout's view in the
background without switching to it, and sends the task to the agent that view already has, as its
first message. `worker_status`, `instruct_worker` and `stop_worker` act on the lead's own workers.

**What a worker does.** Its role is `worker` because the team started its checkout; it is offered the
board and `complete_task` / `fail_task`. Its own conversation is its checkout's ordinary agent panel —
the user can step into it, see its files and terminals, and talk to it.

**Waking the lead.** On `complete_task`, `fail_task`, the user stopping a worker, and — added while
building — a worker whose turn ends without reporting either. The last closes the hole the retired
spike fell into: a worker that errors or simply stops is never silent. Messages to a lead start
`[Team]`; to a worker, `[Lead]`.

**The panel.** Above the lead's transcript, a _Workers_ strip: one row per worker — state, branch,
what it waits on the user for — with Allow/Deny in place for a pending permission, and buttons to
open the worker's checkout or stop it. A worker's questions and edit decisions are answered in its own
checkout (one click from the row).

**Limits.** Four running workers per container (`MAX_ACTIVE_WORKERS`), a fixed bound for now. Starts
are serialised so concurrent calls cannot overrun it. The live-session valve no longer reaps a
session with a turn in flight.

**Wake-ups wait for the lead.** A report is never folded into a turn the lead is running: in a real
two-worker round, the second report steered into the lead's turn was never acted on. Reports wait
until the lead is between turns and are delivered together.

**Verified in the app** with real Claude (Haiku) on a fixture repository: one worker; then two in
parallel, each claiming its file on the board, each commit's permission answered from the lead's
strip, and the lead reading the board and reporting both.

**Not yet built.**

- Run-root validation in main (§9) and caller identity beyond the stamped workspace root — callers
  are identified by their checkout's root, which main stamps from the run's own request.
- Capability settings (push / PR / merge / unattended / caps) — policy is prompt-only for now.
- Any persistence: closing the container tab ends the team (checkouts, branches and conversations
  remain).
- Removing a finished worker's checkout — the user removes it from the Worktrees panel.
- The reachability spec (§13).
