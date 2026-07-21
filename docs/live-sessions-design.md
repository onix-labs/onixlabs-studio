# Persistent, always-live multi-agent sessions — design

Design document for epic #324 (phase P1, #325). This is the **gate**: the architecture below, plus the
two spikes at the end, decide go/no-go before any production code (P2+).

## 1. Purpose

Studio should replace the user's current workflow of running several IDEs — each with its own coding-agent
instance — in separate windows. That means each Studio agent (one per tab/host) must hold a **live session
for its lifetime**, not spin up a throwaway session per message. An agent's session lives until:

- the user starts a **New chat** (which ends the session and opens a fresh one), or
- the **host tab is closed / disposed**.

Conversation history survives app restarts; agents and models are pickable per agent; and features gate on
**per-provider capabilities** (e.g. `/effort` on Claude Code / Codex, not on a raw Qwen model).

## 2. Current architecture (starting point)

Studio runs agents **transiently**, one SDK call per turn:

- `ClaudeAgentProvider.run(context)` (`src/shared/electron/ai/claude-agent-provider.ts`) builds a streaming
  `query({ prompt: promptStream(), options })`. `promptStream` yields the initial user message, then any
  steered messages, and **closes the input when a `result` message arrives with nothing queued**
  (`closeInput()`). The `query()` then ends. **This close-on-`result` is the single thing that makes sessions
  transient.**
- Continuity between turns comes from **`resume`**: `Agent.sessionIdState` captures the SDK session id from
  the `session` event, passes it as `resumeSessionId` on the next turn, and the SDK replays the persisted
  transcript. `restore(sessionId)` rehydrates a conversation on load.
- The **`AgentProvider` seam** already abstracts two implementations: `ClaudeAgentProvider` (Claude Agent SDK,
  subprocess) and `AiSdkAdapter` (Vercel AI SDK, per-call HTTP — Studio owns the tool loop).
- **Run lifecycle** (abort, wall-clock timeout, token-budget clock) lives in `AiManager`, keyed **per run**
  (`runs`, `clocks`, `steers` maps by `requestId`).
- Already present and reusable: per-agent provider/model override (`Agent`), the connections model (#254),
  conversation persistence (`AgentConversation` + `AgentConversationStore`, per-host panels), and the
  capability mechanism (#319/#320: `AgentProvider.commands`/`supportsImages` → `AiProviderInfo`).

**Only the live-session pillar is missing.**

## 3. The core distinction: two provider *shapes*

The primary axis is **agent-harness vs raw-model**, not vendor:

| | **Live-harness provider** | **Stateless-model provider** |
|---|---|---|
| Examples | Claude Code, **OpenAI Codex** | OpenAI API, Qwen, Ollama (via Vercel AI SDK) |
| Who owns the agent loop | The harness (external runtime) | **Studio** |
| Session | A live subprocess session, held open | The replayed transcript; each call is stateless |
| Integration | Spawn + speak a streaming protocol | HTTP request per turn |
| Wants persistence? | **Yes** — hold the session open | No — nothing to hold |

The same underlying model can appear as either shape depending on how it is integrated (Codex-the-agent =
harness; the raw OpenAI API = stateless). Both must sit behind **one `AgentProvider` seam**, and the UI must
treat every tab uniformly as "an agent with a history". **Codex is designed in from the start** (P5) to prove
the live-harness seam is not Claude-specific.

## 4. Target architecture: the `AgentSession` seam

Introduce a session abstraction the provider owns, decoupled from a single run:

- `AgentProvider` declares its **session model** (`live-harness` | `stateless`).
- For live-harness providers, the provider creates an **`AgentSession`** — a long-lived handle that:
  - opens lazily on the first message (spawns the subprocess / streaming query),
  - accepts subsequent user messages as **further turns into the same open stream**,
  - streams the same provider-agnostic `AiEvent`s per turn,
  - exposes `interrupt()` (stop the current turn, keep the session) and `close()` (end the session),
  - reports a stable session id and health.
- For stateless providers, the "session" is a thin adapter over the existing per-call `run` + transcript
  replay — no process held. The `AgentSession` interface is satisfied trivially (each `send` = one call).

The renderer's `Agent` service owns exactly **one** `AgentSession` per conversation for its lifetime.
`send` becomes "push a turn into my session" rather than "start a run".

## 5. Session lifecycle

States: **Idle** (no live session yet) → **Live** (open, may be mid-turn) → **Closed**.

- **Open**: lazily, on the first `send` (avoids holding a process for a tab the user never talks to). The
  resolved **system/user prompt config (#300)** must be fed **at session open**, because the harness binds the
  system prompt once at construction and it persists across turns (Spike A gotcha #6) — a per-tab/per-surface
  prompt cannot be swapped mid-session, so it is resolved and injected transparently when the session opens.
- **Turn**: each `send` pushes a user message; the session streams the turn and settles at a turn boundary
  (`result`) **without closing** — the session stays Live for the next turn.
- **New chat**: `close()` the current session and drop to Idle (next `send` opens a fresh session with no
  history). This is the user's explicit "start over".
- **Host/tab disposal**: `close()` the session and release the subprocess. Tie this to the existing
  per-host agent lifecycle (`agent-hosts` / `agent-sessions`).
- **Interrupt / Stop**: `interrupt()` ends the current turn but keeps the session Live (unlike today's abort,
  which ends the whole run).
- **Idle-reap** (P4): a Live session left idle beyond a **user-configured lifetime** is `close()`d to free its
  subprocess, and transparently reopened (via cold-start resume) on the next `send` — context preserved, small
  reconnect delay. Two controls:
  - A new **`ai.agentSessionLifetime`** setting (Settings › AI): `30 min` / `60 min` / `1 day` /
    `indefinite (always alive)`. Mirrors `ai.runTimeoutMinutes`/`ai.agentShell`.
  - A **memory-pressure LRU safety valve** that reaps least-recently-used sessions when total resource use
    crosses a budget — applies **even in `indefinite` mode**, so "always alive" can never exhaust the machine.

Resource note: the realistic workload is a handful of agents (the user runs ~3 full IDEs today, each far
heavier than a `claude`/`codex` subprocess). The lifetime setting + memory valve put the user in control; an
"only the active tab stays Live" optimisation remains a possible later refinement, not a prerequisite.

## 6. Persistence & cold start

- **While the app runs**: the Live session holds context **in-process** (the harness's own memory), so turns
  need not re-send history. Studio still records the transcript to `AgentConversationStore` for display and
  cold-start.
- **Across restarts**: the live process is gone. On load, Studio rehydrates the transcript from the store
  (display) and, on the next `send`, **lazily reopens** a Live session using the SDK's `resume` (the harness
  replays its persisted session). So `resume` narrows from "every turn" to **cold-start / post-reap only**.
- **Source of truth**: define clearly — the harness owns the live conversation state; Studio's store is the
  durable record for display + the resume key. Avoid double-writing divergent histories.

## 7. Lifecycle plumbing migration

Move from per-**run** to per-**session**, keeping per-turn semantics within:

- `AiManager`'s `runs` / `clocks` / `steers` maps re-key from `requestId` to a session id (with the current
  turn tracked within the session).
- **Abort** splits into **interrupt-turn** (default Stop button) vs **close-session** (New chat / tab close).
- The **wall-clock timeout** and **token-budget** become per-turn budgets within a persistent session (the
  session itself has no fixed end); revisit whether a session-level idle timeout replaces the run timeout.
- Steering (already streaming-input based) becomes the *normal* path: every `send` after the first is a
  steer into the open session.

## 8. Spike A — can one Claude `query()` hold a multi-turn session open?

**Verdict: YES.** Proven both at the type level (SDK v0.3.177) and by a **real run** against the local Claude
login. A held-open spike sent turn 1 ("Remember … PLATYPUS" → `result` "OK"), then — without closing the
input — pushed turn 2 ("What word?") into the **same** query → second `result` "PLATYPUS", **same
`session_id`, no `resume` used.** So `result` ends the **turn, not the session**; the output generator blocks
after a `result` awaiting the next input message and processes it as the next turn in the same live session.

Mechanism: with a streaming `AsyncIterable<SDKUserMessage>` prompt, `query()` lives as long as the input
iterable stays open (`sdk.d.ts:2489`, `Query extends AsyncGenerator` `:2240`, `streamInput` "for multi-turn
conversations" `:2459`). Streaming-only control methods confirm the model: `interrupt()` `:2250`,
`setModel()` `:2264`, `setPermissionMode()` `:2257`, `applyFlagSettings()` `:2300`. Turn-over signal:
`result`, or the "authoritative" `SDKSessionStateChangedMessage` `state:'idle'` (`:3952`).

**Studio is already ~90% there.** `ClaudeAgentProvider.run` already runs streaming-input mode: `promptStream`
yields the initial message, then parks on a `wake` promise and yields steered messages as further turns — the
exact held-open mechanism. The **only** thing making runs transient is the deliberate close:
`if (message.type === 'result' && pendingSteers.length === 0) { closeInput(); break; }`. The core of P3 is
**stop closing on `result`**, keep the query + `promptStream` alive for the agent's life, and push each new
user message through the existing `setSteerHandler`/`pendingSteers` path (renamed "steer" → "next turn").

**Implications / gotchas for P3 (#327):**

1. **Don't `break` the `for await` on `result`.** It's a turn boundary, not the end. Use `result` (or
   `session_state_changed`→`idle`) to mark "turn done, ready for next input" for the UI/queue.
2. **Hold the `Query` handle for the agent's life.** Today `run` discards the local `response` after the loop.
   A persistent agent must retain it to call `interrupt()`, `setModel()`, `setPermissionMode()`, and push
   turns. Restructure `run` from "one call = one turn" into a long-lived session object owning the
   query + input generator.
3. **Abort vs interrupt are different levers.** `abortController`/`close()` kills the query + subprocess →
   reserve for **agent disposal / New chat**. `interrupt()` stops the **current turn** and keeps the session
   → the right primitive for a per-message **Stop** button. Today's abort→`closeInput` tears everything down.
4. **`resume` is cold-start only.** While the query is held open, context is in-process and `resume` must NOT
   be set. Keep `resume` for reconstituting a conversation into a *new* held-open query (app restart / crash /
   post-idle-reap); drop it for same-query turns.
5. **Cost is cumulative across the held-open query; `num_turns` is per-turn.** The provider already tracks
   per-turn cost deltas via `usageState.lastCostUsd` — keep that; don't assume `num_turns` accumulates.
6. **Per-turn option changes go through control methods,** not option rebuilds: `canUseTool`/hooks/MCP/systemPrompt
   are bound once at `query()` time and persist across turns, so a mid-session posture/model change uses
   `setPermissionMode()`/`setModel()`/`applyFlagSettings()`. (Today's code rebuilds all options per run.)
7. **A fresh `system:init` re-emits at the start of each turn** with the same `session_id`; the emit-once
   session logic already tolerates it, but any per-turn setup keyed off `init` must be idempotent.
8. **Resource/compaction:** each held-open query = one live CLI subprocess for the agent's life + a growing
   in-process transcript. Budget explicit `close()` on teardown; rely on the SDK's auto-compaction
   (`SDKCompactBoundaryMessage`) for very long sessions.

**Fallback if held-open ever proves unhealthy at scale:** "warm resume" — re-`resume` each turn but keep the
subprocess warm — a weaker but viable model. Not needed based on this spike.

## 9. Spike B — OpenAI Codex integration surface

**Verdict: strong fit behind the existing seam.** Codex is *more* integration-ready than Claude Code. (Codex
not installed locally; findings are from current Jul-2026 web sources + `npm view` — SDK & CLI both at
**0.144.6**, fast-moving; runtime-behaviour claims marked unverified.)

**Three programmatic surfaces**, all wrapping the same Rust core:
- **`codex exec`** — one-shot headless, JSONL with `--json`. **Unsuitable for Studio** — approval requests
  fail the run unless auto-approved. (CI use only.)
- **`@openai/codex-sdk`** — official TS/Node SDK; **spawns the CLI and exchanges JSONL over stdio**, exactly
  Studio's model with the Claude SDK. `codex.startThread()` → `thread.run()/runStreamed()`. Low-risk, but its
  typed event/approval surface is thinner.
- **`codex app-server`** — stateful **JSON-RPC 2.0** over stdio (the protocol the SDK speaks underneath).
  **Best fit** — full bidirectional protocol with server-initiated approval requests. **Recommended target.**

**Persistent multi-turn session: yes, and richer than Claude.** app-server: `thread/start` → repeated
`turn/start` on the same thread; `turn/steer` (append to in-flight turn), `turn/interrupt` (cancel turn),
`thread/resume` (restore from `~/.codex/sessions`), `thread/fork` (branch). This lines up **almost 1:1** with
`AgentRunContext`: `resumeSessionId`→`thread/resume`, `forkSession`+`resumeSessionAt`→`thread/fork`,
`signal`→`turn/interrupt`, `setSteerHandler`→`turn/steer`.

**Approvals are the key match.** The app-server sends **server-initiated JSON-RPC requests and blocks on the
reply** — structurally identical to Studio's `requestPermission`/`requestEditDecision`/`requestInput`:
- `execCommandApproval` → `context.requestPermission`
- `applyPatchApproval` (carries diffs) → `context.requestEditDecision` (`hasDiff` staged preview)
- elicitation → `context.requestInput`
Governed by `approval_policy` (`user`/auto) + `sandboxPolicy` (`read-only`/`workspace-write`/
`danger-full-access`/**`externalSandbox`** for pre-sandboxed hosts).

**Other capabilities:** reasoning effort `none|minimal|low|medium|high|xhigh` (**superset of Claude's**, per
thread/turn; `model/list` discovers models + efforts); model selection; images (`local_image` inputs). Auth:
`CODEX_API_KEY` env or ChatGPT/OpenAI login in `~/.codex/auth.json` (maps to `AgentAuth`; parallels the
reuse-local-Claude-login story). Packaging: Node shim + **per-platform native binaries via
`optionalDependencies`** (all 6 desktop targets) — the same asarUnpack + resolve-binary approach used for the
`claude` binary (#141).

**`CodexAgentProvider implements AgentProvider` sketch** (drive the app-server over stdio): spawn/reuse a
persistent `codex app-server`; `initialize` handshake; `thread/start`|`resume`|`fork` with model/cwd/sandbox;
`turn/start` with prompt+images, wire `setSteerHandler`→`turn/steer` and `signal`→`turn/interrupt`; translate
`item/*`+`turn/*` notifications → `AiEvent`s via `context.emit`; route approval requests → the
`requestPermission`/`requestEditDecision`/`requestInput` round-trips; forward `turn/completed` usage to the
token meter; `recordAudit` executed actions.

**Divergences that stress the abstraction (design carefully):**
- **Enforcement locus differs — the biggest task.** Studio's hard, non-overridable **write-confinement**
  (agent-confinement ruling) is enforced today via `canUseTool`/`disallowedTools`. Codex has **no per-tool
  denylist** — enforcement is `sandboxPolicy` + `approval_policy`. Confinement must map onto
  `sandboxPolicy: workspace-write` roots (or `externalSandbox` + Studio's own boundary), **not** onto
  session-scoped `acceptForSession` shortcuts. And, as with Claude's classifier-auto-run lesson
  (agent-hardening), **verify empirically** whether Codex ever executes commands without raising an approval
  under a given policy — unverified (Codex not installed).
- **`reasoningEffort` seam:** the commands epic (#320, unmerged) already adds `AgentRunContext.effort`; Codex
  reuses it. Once #316 merges, the effort field is shared by both harnesses (nice synergy; note the
  cross-branch dependency).
- **Two-layer choice:** build on the **app-server** (or SDK + its `request()` escape hatch) for first-class
  approval fidelity, rather than the thinner typed SDK surface.
- **Version velocity:** pin the version (as with the Kotlin LS / netcoredbg); app-server WS transport is
  flagged experimental — prefer **stdio**.

Sources: OpenAI Codex docs (codex-sdk, non-interactive-mode, app-server), `openai/codex` GitHub
(sdk/typescript, codex-rs/app-server), `@openai/codex-sdk` on npm.

## 10. Risks & open questions

- **Held-open session health** (Spike A): does a Claude `query()` stay healthy across many turns, and how do
  abort/interrupt/memory behave? If it can't be held open, P3 falls back to "warm resume" (re-`resume` each
  turn but keep the process warm) — a weaker but still viable model.
- **Codex divergence** (Spike B): if Codex's protocol/session model differs materially from the Claude Agent
  SDK, the `AgentSession` seam must absorb the difference without leaking into the UI.
- **Resource ceiling**: many Live subprocesses at once. Mitigations: lazy open, idle-reap, optional
  active-tab-only. Needs a measured budget from Spike A.
- **Cold-start correctness**: resume must faithfully restore context; reconcile store vs harness state.
- **Stateless parity**: the `AgentSession` interface must fit stateless providers cleanly (no forced process
  model) so the UI stays uniform.

## 11. Go / no-go decision (end of P1)

**Decision: GO.** All three criteria met.

1. ✅ **Spike A** — a Claude `query()` holds a multi-turn session open with context retained in-process
   (real-run proof), and a clean interrupt-turn vs close-session story exists. Studio already runs
   streaming-input mode, so P3 is a targeted change ("stop closing on `result`" + hold the `Query` handle),
   not a rewrite. Warm-resume fallback identified but not needed.
2. ✅ **Spike B** — Codex has a first-class programmatic surface (`codex app-server`, JSON-RPC over stdio)
   whose thread/turn/steer/interrupt/resume/fork + server-initiated approvals map almost 1:1 onto
   `AgentRunContext`. It fits behind `AgentProvider` with no core-loop seam changes; the one worthwhile
   extension (`reasoningEffort`) is already arriving via #320.
3. ✅ The `AgentSession` abstraction (§4) fits all three shapes — two live-harnesses (Claude, Codex) and
   stateless-model — without special-casing the UI.

**Carry-forward conditions into later phases:**
- **P3/P5 — confinement equivalence is the top design risk.** Both harnesses can execute without a per-call
  gate (Claude's classifier-auto-run; Codex's sandbox/approval-policy). Studio's hard write-confinement must
  be enforced through the harness's real mechanism (Claude `disallowedTools`/sandbox; Codex `sandboxPolicy`
  roots), **never** via a rubber-stamped session-accept. Verify empirically for Codex once installed.
- **P5 — pin the Codex version** (fast-moving 0.144.x) and prefer the stdio transport.
- **Resource budget** — measure held-open subprocess memory during P3; idle-reap (P4) is the safety valve.

## 12. Decisions (P1 review, 2026-07-21)

Seven design decisions, agreed one-by-one with the maintainer:

1. **Provider model → `AgentSession` seam.** One `AgentSession` behind `AgentProvider`; live-harness
   (Claude, Codex) hold a live session, stateless-model (Qwen/OpenAI/Ollama) satisfy it trivially; the UI
   treats every tab uniformly. (Not "everything is a live session"; not separate per-kind paths.)
2. **Session opens lazily on the first message.** No process for a tab you never talk to. **Dependency:** the
   configurable system/user prompt (#300) is fed **at session open** (bound once per session — see §5).
3. **Session lifetime is user-configurable, with a hard safety net.** New `ai.agentSessionLifetime` setting
   (`30 min` / `60 min` / `1 day` / `indefinite`) drives idle-reap, **plus** a memory-pressure LRU valve that
   reaps even under `indefinite`. (Not a fixed policy — the user decides.)
4. **Stop interrupts the turn; the session stays live.** Stop = `interrupt()`/turn-interrupt; only **New chat**
   and **tab close** end the session. (Not today's tear-down-the-run abort.)
5. **Confinement = harness sandbox, Studio sets the roots.** Claude via `disallowedTools` + SDK sandbox; Codex
   via `sandboxPolicy: workspace-write` locked to the confinement roots. Never widened by a per-action
   session-accept — upholds the hard-boundary ruling. (Not Studio-enforces-itself; not belt-and-braces.)
6. **History: harness owns live context; Studio's store is the durable record + resume key.** No per-turn
   history replay while live. (Not Studio-single-source.)
7. **Codex lands at P5**, after the live-session lifecycle is proven on Claude (P3) and cold-start/reap (P4).
   The P2 seam is designed Codex-aware regardless. (Not earlier / not co-designed into P2.)

## 13. Phase mapping

- **P1 (#325)** — this doc + spikes + go/no-go.
- **P2 (#326)** — `AgentSession` seam + session-model declaration, no behaviour change.
- **P3 (#327)** — persistent Claude session per agent (stop closing on `result`; per-session lifecycle).
- **P4 (#328)** — cold-start rehydration + idle-reap.
- **P5 (#329)** — `CodexAgentProvider` (second live-harness).
- **P6 (#330)** — per-provider capabilities + live command discovery (supersedes #322).
