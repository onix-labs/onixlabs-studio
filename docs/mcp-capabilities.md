# MCP capabilities by tab type

Studio exposes its in-app capabilities to the AI agent as an in-process MCP server named
`studio` (`src/shared/electron/ai/claude-agent-provider.ts`). Tool handlers do not touch the
main process's own state: each call is bridged back into the renderer
(`src/shared/electron/ai/studio-tools.ts` → `AiRuntime` capability registry), so the agent acts
on the live editor/terminal state — including unsaved edits — exactly as the user sees it.

Which tools the server registers is decided per run by the **surface** the hosting tab declares
(`AgentSurface = 'editor' | 'terminal' | 'binary' | 'project'`,
`src/shared/api/ai/ai-tool-surface.ts`), and
each tool is bound to the **owning tab** (`owningTabId`), so an agent docked to one tab cannot
act on another. The Claude (Agent SDK) provider registers the tools as a real MCP server
(`mcp__studio__<tool>`); the Vercel AI SDK and Ollama providers expose the identical tool set as
plain AI-SDK tools (`src/shared/electron/ai/ai-sdk-stream.ts`), so capabilities are
provider-independent — but permission gating is not (see [Cross-cutting rules](#cross-cutting-rules)).

## Summary

| Tab type   | Surface    | Studio MCP tools                                                                                                          | Conversation scope    |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| Code       | `editor`   | `read_active_document`, `edit_active_document`, `insert_into_active_document`, `replace_active_document`                  | `file` (document id)  |
| Markdown   | `editor`   | `read_active_document`, `edit_active_document`, `insert_into_active_document`, `replace_active_document`                  | `file` (document id)  |
| Terminal   | `terminal` | `read_terminal_output`, `write_terminal_input` — **all other tools denied**                                                | per terminal tab      |
| Agent      | `project`  | **none** — the built-in Agent SDK tools are this surface's capability set (see below)                                      | `global`              |
| Workspace  | `editor`   | editor tools (resolve to the focused editor in the document well)                                                          | `workspace` (root)    |
| Repository | `editor`   | editor tools (resolve to the focused editor in the document well)                                                          | `repository` (root)   |
| Binary     | `binary`   | `read_binary_overview`, `read_binary_bytes`, `read_binary_selection`, `read_binary_disassembly`, `patch_binary_bytes`      | per binary tab        |

The tool name constants live in `src/shared/api/ai/ai-tool-surface.ts`; the conversation-scope
kinds (`global` / `workspace` / `repository` / `file`) in
`src/shared/api/agent-conversation-channels.ts`.

## Code

The code view docks an agent side panel (`code-agent-panel`) that hosts the shared
`AgentConversationPanel` with the tab's id and the default `editor` surface.

- **`read_active_document`** — returns the full text of *this tab's* Monaco document, including
  unsaved edits (auto-allowed; also available in Chat mode).
- **`edit_active_document`** — string-anchored edit: replaces one exact occurrence of
  `old_string` with `new_string` (`replace_all` for every occurrence; empty `new_string`
  deletes). The anchor must match uniquely — ambiguous or missing anchors fail with recovery
  guidance for the model. Applied as a granular Monaco range edit, so undo stays per-edit and
  the rest of the document is untouched.
- **`insert_into_active_document`** — inserts text before/after a uniquely-matching anchor
  string, or at the document's start/end.
- **`replace_active_document`** — replaces the document's entire text; the prompt appendix
  steers the model to the granular tools for targeted changes and reserves this for full
  rewrites.
- All mutating editor tools are undoable in-editor edits: auto-allowed in Agent mode (the
  change is visible and undoable), withheld entirely in Chat mode.
- The system prompt (`STUDIO_PROMPT_APPENDIX`) steers the model to put generated/edited content
  into the editor via these tools rather than writing files to disk.
- Conversations are scoped to the file, so each document keeps its own history.

## Markdown

Identical wiring to Code (`markdown-agent-panel` → `editor` surface, file-scoped conversations),
with one difference in resolution: the capability handler
(`src/features/agent/angular/agent-editor-capabilities/agent-editor-capabilities.ts`) consults
the markdown command seam first, so the agent reads the live markdown source of the Crepe
editor (including unsaved edits). Mutations round-trip through the source: the edit/insert is
applied to the markdown text and the result is parsed back into the editor, so anchors match
exactly what `read_active_document` returned.

## Terminal

The terminal view docks `terminal-agent-panel`, which sets `surface="terminal"`. This is the
most confined surface — the agent is deliberately locked to its terminal:

- **`read_terminal_output`** — returns the recent output shown in the owning terminal
  (auto-allowed).
- **`write_terminal_input`** — types text into the terminal, running it as a command by default
  (`submit: false` types without executing). Never auto-allowed by `allowedTools`; it flows
  through the permission posture, and Chat mode withholds it entirely.
- **Everything else is denied.** The Claude provider's `canUseTool` rejects every tool that is
  not one of these two, including the built-in file-system and shell tools — the agent inspects
  files by running `ls`/`cat`/`grep` in the terminal the user is watching, not through hidden
  tooling. The `TERMINAL_PROMPT_APPENDIX` tells the model exactly that.

## Agent (standalone tab)

The standalone Agent tab (`agent-view`) is a full-page chat with a `global` conversation scope
and the dedicated `project` surface. It has no document of its own, so **no studio MCP server is
registered at all** — the run's capability set is the **built-in Agent SDK tools**: with a
workspace open (or files/folders attached), `Read`/`Glob`/`Grep` are auto-allowed, and edits,
shell, and other built-ins are available subject to the permission posture, with the workspace
root as the working directory (falling back to the home directory). The prompt appendix
(`PROJECT_PROMPT_APPENDIX`) tells the model it is undocked and that on-disk changes surface in
the IDE (editors follow external changes; explorers refresh live). This is the surface for
project-wide work.

Note the provider caveat below: on the Vercel AI SDK and Ollama engines — which have no built-in
tools — a `project` run carries no tools at all.

## Workspace

The workspace view's dock blueprint includes the shared `AgentPanel`, which hosts
`AgentConversationPanel` with **no owning tab id** — the run is unscoped. The editor tools then
fall back to the *focused* editor: markdown first, then code. So the agent reads/edits whatever
document is active in the workspace's document well, tracking the user's focus rather than a
fixed document.

- Conversations are scoped to the workspace root (`workspace:<path>`), so each workspace keeps
  its own history; before a folder is open the panel uses the global bucket.
- The workspace root is the run's working directory, and `Read`/`Glob`/`Grep` are auto-allowed
  for project exploration.

## Repository

Same mechanics as Workspace — the repository (source-control) view's dock blueprint stacks the
shared `AgentPanel` behind the Commit panel, unscoped, `editor` surface — but the conversation
context resolves to the **git repository root** (`repository:<root>`), lazily, so it tracks the
repository bind (`source-control-view.ts`). The conversation is provided at the view level
rather than inside the dock panel, so switching the Commit/Agent tool stack does not destroy the
transcript or an in-flight run.

`read_active_document` / `replace_active_document` resolve to the focused editor in the
document well when one is open (e.g. a file opened from a commit); with only diff views open
there may be no active document to resolve.

## Binary

The binary (hex editor) view docks `binary-agent-panel` with `surface="binary"` — the richest
in-app tool set:

- **`read_binary_overview`** — path, size, container format, architecture, disassembly
  availability, current cursor/selection. The prompt appendix tells the model to call this
  first.
- **`read_binary_bytes`** — hex + ASCII dump of a byte range (bounded window, default 256
  bytes), so GiB-scale files are read incrementally.
- **`read_binary_selection`** — hex + ASCII dump of the user's current selection.
- **`read_binary_disassembly`** — assembly listing for a byte range when the format is natively
  disassemblable.
- **`patch_binary_bytes`** — overwrites bytes at an offset (length unchanged) as an unsaved,
  undoable edit the user reviews. The four read tools are auto-allowed; the patch tool always
  flows through the permission posture, and Chat mode withholds it.

The renderer formats all dumps/listings, so presentation lives in one place; the tools relay the
rendered text. Read-only project exploration (`Read`/`Glob`/`Grep`) is also auto-allowed when a
workspace or attached context is present.

## Cross-cutting rules

These apply to every tab type:

- **Modes** — every agent panel offers **Agent** and **Chat** modes. Chat is read-only: mutating
  studio tools are not registered at all, built-in read-only exploration (`Read`/`Glob`/`Grep`)
  is allowed, and everything else is denied without prompting (`READ_ONLY_APPENDIX` tells the
  model to advise instead of act).
- **Permission posture** (`prompt` / `auto-edits` / `auto-all`, a setting) — read-only tools are
  always allowed; `auto-edits` additionally auto-allows the built-in file-edit tools
  (`Write`/`Edit`/`MultiEdit`/`NotebookEdit`) but still prompts for shell/exec; `prompt` asks
  before anything mutating or executing. In-app editor tools are auto-allowed in Agent mode
  regardless of posture because the result is visible and undoable in the editor; the terminal
  write and binary patch tools are the deliberate exceptions and follow the posture.
- **Provider parity caveat** — the permission broker (`canUseTool`) and the terminal confinement
  are enforced by the **Claude Agent SDK provider**. The Vercel AI SDK and Ollama providers
  expose the same surface-selected tool set but have no per-tool permission hook, so their tool
  calls run ungated (`ai-sdk-stream.ts`); they also have no built-in file/shell tools, so their
  reach is limited to the studio tools themselves — and on the `project` surface (which has no
  studio tools) they have no tools at all.
- **Attached context** — Attach File / Add Folder pass paths by reference (`contextPaths`); the
  prompt preamble lists them and the built-in `Read`/`Glob` tools are auto-allowed so the agent
  can read them even without an open workspace.
- **Sessions** — each conversation resumes its provider session (`resumeSessionId`) so earlier
  turns' context (including tool calls) persists across turns within a conversation scope.
