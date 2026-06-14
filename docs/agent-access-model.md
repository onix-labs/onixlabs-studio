# AI Agent — access & permission model

How Studio bounds what an AI agent can see and do, on the local machine and inside the app. Defined
for the v0.4 agent epic (#106); the enforcement points named here live in the main process.

## Authentication

- The agent authenticates from the user's **local Claude login** (`~/.claude`, the same credential
  Claude Code uses) or, as a fallback, a user-supplied **API key** stored encrypted at rest via the
  OS secure-storage facility (`safeStorage`).
- The API key **never crosses the contextBridge** to the renderer. Only narrow status, configuration,
  run-control, and verification calls are exposed (`AiAuthManager`, `AiApi`).

## Scope of a run

- The agent's working directory is the **open workspace root** (`AiRunRequest.workspaceRoot`), or the
  user's home directory when no workspace is open — never Studio's own installation directory.
- Each run is cancellable; aborting it stops the underlying agent process and denies any permission
  prompt still pending.

## Tool permissions (machine)

The agent's built-in tools are gated in the main process through the Agent SDK's `canUseTool` hook:

| Tool class | Examples | Policy |
|---|---|---|
| Read-only | `Read`, `Glob`, `Grep` | **Auto-allowed** within the run (no prompt). |
| Mutating / exec | `Edit`, `Write`, `Bash`, … | **Ask the user** before each use. |

A gated tool triggers the permission flow:

1. The provider's `canUseTool` calls `context.requestPermission(name, detail)`.
2. `AiManager` emits a `permission` event (tool name + a one-line summary of what it will do) and
   awaits the user's answer.
3. The renderer surfaces it (an inline Allow / Deny prompt in the chat) and replies via
   `AiRuntime.respondPermission`.
4. The tool runs only on an explicit **Allow**; **Deny** (or aborting the run) refuses it.

The user is the gate: the summary shown includes the target path or command so consent is informed.

## In-app capabilities

The agent can also act **inside the app** (e.g. read or edit the live editor document) through the
renderer capability registry: providers call `context.bridge.request(capability, input)`, which is
correlated over the `RendererBridge` to a handler registered on `AiRuntime`. In-app capabilities are
opt-in (only registered capabilities are reachable) and run in the renderer with the same trust as the
rest of the UI. The concrete capabilities land with the in-app tool layer (#142).

## What is *not* granted

- No access to the API key from the renderer.
- No tools beyond those the provider declares; unknown capability names are rejected by the bridge.
- No silent mutation: every machine write/exec is consent-gated.

## Enforcement points

- `AiAuthManager` — credential resolution; key stays in main.
- `ClaudeAgentProvider.canUseTool` — read-only allow-list vs. ask-the-user gating.
- `AiManager.requestPermission` / `resolvePermission` — the permission broker.
- `RendererBridge` + `AiRuntime` capability registry — the in-app capability surface.

## Future hardening (v0.5+)

- Confine machine writes to the workspace root (SDK `additionalDirectories` / sandbox) as
  defence-in-depth beyond per-action consent.
- Per-capability and per-tool default policies surfaced in Settings (#112).
- Audit log of granted actions.
