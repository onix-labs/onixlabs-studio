# AI agent — manual test playbook

Manual, user-driven verification for every feature shipped by the **Agent feature-completeness
epic (#237)**, sub-issues #238–#253. Each feature was verified this way before its branch merged;
this document preserves those tests as a regression playbook for future agent work (provider
upgrades, SDK bumps, transcript refactors).

Automated coverage lives in the unit suites (`agent.spec.ts`, `agent-chat.spec.ts`,
`agent-conversation.spec.ts`, …); this playbook covers what those cannot: real provider round-trips,
IPC, persistence across restarts, and look-and-feel.

## Prerequisites

- **Dev instance** running (`npm start`), with a workspace folder open (any repo works; this one is
  ideal because tests reference its files).
- **Claude provider**: a local Claude login (`claude` CLI logged in) or an Anthropic API key in
  Settings → AI.
- **Ollama provider**: Ollama running locally with the default model pulled
  (`ollama pull qwen3:8b`). Used wherever a test says "on Ollama" — it exercises the AI-SDK code
  path, which differs from the Claude Agent SDK path.
- **Permission posture**: Settings → AI → Permission posture = _Ask every time_ unless a test says
  otherwise. Several tests depend on prompts actually appearing.
- Conversations are per-host. "Agent tab" = the standalone Agent tab (surface `project`); "docked
  panel" = the agent panel docked to a code/markdown/terminal/binary tab.

Suggested order: run top to bottom — later tests lean on earlier features (e.g. the timeout test
lands on the structured error card from #245).

---

## Wave 1 — event protocol

### #238 — Interactive input (`ask_user`)

1. **Choice question (Claude).** In an agent tab, send:
   _"I want to store user preferences. Ask me which storage to use before doing anything — offer
   me at least three options with a recommendation."_
   Expect an accent-bordered question card with a **radio list** (`label: description` rows,
   recommended first), an **Answer** button that stays disabled until a radio is picked, and a
   **Skip** button. Pick an option, press Answer — the run continues using the choice.
2. **Free-form answer.** Prompt: _"Ask me what to name the new module, then stop."_ While the
   question is pending, the composer header flips to **Answer** and the placeholder to
   _"Answer the agent…"_. Type an answer and press Answer — it appears on the card as `→ answer`.
3. **Skip.** Repeat and press **Skip** — the card settles to _"Not answered"_ and the agent
   continues without one (it should say so).
4. **Run-end dismissal.** While a question is pending, press **Stop**. The card must settle to
   _"Not answered"_ and the composer must leave answer mode (never a stuck Answer composer).
5. **Provider parity.** Repeat test 1 on **Ollama** — the question round-trip must behave
   identically (the AI-SDK twin of the tool).
6. **Restore normalisation.** Ask a question, quit the app without answering, relaunch, reopen the
   conversation from History. The persisted question must show as dismissed, not pending.

### #239 — Sub-agent visibility (lanes)

1. **Spawn a sub-agent (Claude only).** In an agent tab with a workspace open, send:
   _"Use a sub-agent to explore src/shared/electron/ai and report what each file does."_
   Expect a **lane** row on the timeline (not a plain tool chip): title = sub-agent type (e.g.
   `Explore`), a live status showing the nested tool currently running (e.g. _Reading file…_),
   and a meta readout accumulating `n tools, x.xk tokens`.
2. **Expand mid-run.** Open the lane while it runs: nested tool rows appear live (spinner on the
   running one), interleaved with the sub-agent's own text.
3. **No meter double-count.** Watch the composer's context meter during the run: sub-agent tokens
   accumulate on the **lane's** meta only; the context meter updates once from the turn's terminal
   usage (which already folds sub-agents in). The meter must not spike per sub-agent turn.
4. **Parallel lanes.** _"Use two sub-agents in parallel: one summarises package.json, the other
   counts files under src/shared."_ Two lanes must render, each with its own status and children —
   no cross-contamination of text between lanes.

---

## Wave 2 — trust rails

### #240 — Provider-consistent gating

1. **Ollama asks before writing.** In a **terminal** tab's docked agent, on Ollama, posture
   _Ask every time_, send: _"Run `echo hello` in the terminal."_ A permission prompt must appear
   before anything is typed into the terminal (pre-#240 the AI-SDK path silently ignored posture).
2. **Chat mode is read-only everywhere.** Switch Mode to **Chat** (ribbon or `/mode`). On both
   Claude and Ollama, ask the agent to edit the open document — it must refuse/explain, and no
   mutating tool may run. Read requests (e.g. "what's in this file?") still work.
3. **Auto-all skips prompts.** Set posture to _Auto-allow everything_, repeat test 1 — the command
   runs without a prompt. Reset the posture afterwards.

### #241 — Permission broker (remembered decisions)

Each pending permission card has a scope dropdown: _Just this once / For this session / For this
workspace / Always_ (workspace entry only when a workspace is open).

1. **Once.** Allow with _Just this once_, then have the agent run the same tool again — it must
   prompt again.
2. **Session.** Allow with _For this session_ — subsequent uses of that tool don't prompt. Restart
   the app — it prompts again.
3. **Workspace.** Allow with _For this workspace_ — no prompt in this workspace, including after a
   restart. Open a different folder — it prompts there.
4. **Always.** Allow with _Always_ — no prompt anywhere, surviving restart
   (rules persist in `userData/agent-permission-rules.json`).
5. **Denials are never remembered.** Deny with any scope selected — the very next use must prompt
   again (a mis-click can never permanently brick a tool).
6. **Settled label.** After answering, the card shows the scope it was granted with (e.g.
   _"Allowed for this workspace"_).

### #242 — Edit preview (staged diffs)

Posture _Ask every time_, Mode _Agent_.

1. **Code diff in the well.** In a code tab's docked agent: _"Rename the variable x to total in
   this file."_ Expect: a **diff opens in the document well** showing the staged change, and the
   transcript shows a decision card with three stacked, full-width options —
   **Yes** / **Yes, and automatically accept edits** / **No**.
2. **Yes** applies the edit to the editor (undoable, unsaved); the diff closes; the card settles
   to _Applied_.
3. **No** discards; the document is untouched; the card settles to _Rejected_.
4. **Yes-auto.** Choose the middle option once, then request another edit in the same app session —
   it applies with **no** preview. The card that granted it reads
   _"Applied · auto-accepting edits this session"_. Restart clears the auto-accept.
5. **Markdown is card-only.** In a markdown tab's docked agent, request an edit — no diff editor
   opens (Crepe has none); the card alone carries the summary and the same three options.
6. **Run-end dismissal.** Stop the run while a preview is pending — the staged diff is cancelled
   and the card settles to _Not decided_.

### #253 — Agent-requests inbox (title-strip tab menu)

1. **Bell.** Start a run in a background agent tab that raises a permission prompt. The title
   strip's tab-menu chevron (in the button group, left of the tabs) becomes an **accent bell**;
   its tooltip counts waiting requests.
2. **Nested entries.** Open the menu: the request renders **under its hosting tab's row** (bell
   marker on the tab row); requests from the Workspace/Repository panels appear under a trailing
   _Agent panels_ heading.
3. **Inline answers.** Allow/Deny (permissions), Yes/No (edit decisions), or pick a suggested
   choice / Skip (questions) directly in the menu — the originating tab's transcript card settles
   identically (single source of truth).
4. **Menu stays open** while other requests remain pending after answering one, and **closes
   itself** when the last one settles.
5. **Jump to tab.** Clicking a request's source line activates its tab (needed for free-form
   answers and remember-scoping, which stay on the transcript card).

---

## Wave 3 — transcript depth

### #243 — Thinking disclosure

1. **Live streaming.** On Claude, send: _"Think carefully: what's the cleanest way to add undo
   support to the binary editor? Weigh at least three approaches before answering."_
   Expect a collapsed disclosure on the rail labelled **Thinking…** with a spinner node and a
   **live word count** ticking up.
2. **Expand mid-stream** — the reasoning streams into the open disclosure as dim prose.
3. **Settled state.** After the turn moves on, the row reads **Thought process** with a static
   brain glyph; still expandable.
4. **Persistence.** Reopen the conversation from History — the disclosure (and its text) survives,
   default-collapsed.

### #244 — Expandable tool detail

1. **Input/Output.** Run: _"List the files in src/shared/electron/ai and read tool-format.ts."_
   Expand a tool chip: below the one-line summary, an **INPUT** section shows the full
   pretty-printed input and an **OUTPUT** section the raw result, each in a scrollable block.
2. **Show all.** The read of a long file must clip at ~1,500 characters behind
   **"Show all (n more characters)"**; clicking reveals the rest. Extremely large payloads are
   clamped at the source with an explicit `… [truncated: n more characters]` marker — never
   silently cut.
3. **Error section.** Ask the agent to read a nonexistent path — the failed chip's section is
   labelled **ERROR** in the warning colour and carries the provider's error text.
4. **Lanes too.** Expand a sub-agent lane — the same INPUT (the Task prompt) and OUTPUT (the
   sub-agent's report) sections sit at the bottom of the lane body.
5. **Provider parity.** Repeat test 1 on Ollama — AI-SDK tool rows must carry full input/output
   too, and their one-line summaries must not be blank for object inputs.
6. **Persistence.** Reopen from History — expanded detail is still available on old tool rows.

### #245 — Structured error items + retry

1. **Error card.** Quit Ollama, select the Ollama provider, send any message. Expect an
   off-rail card in warning chrome: warning icon + one-line cause, a mono provider/model readout
   (e.g. `Ollama · qwen3:8b`), a **Details** disclosure with the raw error, and a **Retry**
   button — not an italic "the run failed" line.
2. **Retry.** Start Ollama, press **Retry** — the same prompt re-runs **without duplicating your
   message** in the transcript; the button is replaced by _Retried_. A retry that fails again
   produces a fresh card with its own Retry.
3. **Tool context.** Cause a run to fail right after a failed tool — Details must include a
   _Failed tool — name: output_ line.
4. **Persistence.** Reopen the conversation from History — the card, its diagnostics, and a
   still-working Retry survive.

---

## Wave 4 — ergonomics

### #246 — Message queueing and mid-run steering

1. **Steering (Claude).** Start a longer task (_"Explore this repo and summarise each top-level
   directory"_). Mid-run, type _"Also count the total lines of TypeScript"_ — **Send appears once
   you type** (Stop stands alone, coral-outlined, until then). Send it: your message appears in
   the transcript immediately and the **same run** addresses it as a further turn — no abort, no
   restart, context retained.
2. **Queueing (Ollama).** Same flow on Ollama: the message lands in a **dashed queue row** above
   the input instead. Queue two; use the pencil (edit back into the composer) and the ✕ (remove)
   affordances. When the run completes, one queued message dispatches per completed run, in order.
3. **Hold on stop/error.** Queue a message, then press Stop — the queue must **not** dispatch; the
   rows remain for you to edit, remove, or send later.
4. **Persistence.** Queue a message, close and reopen the conversation from History — the queue
   rows survive (text only) and dispatch after the next completed run.
5. **Answer mode wins.** While the agent has a pending question, the composer stays in Answer
   mode — sending answers the question rather than steering/queueing.

### #247 — Edit-and-resend, retry, branching

All on Claude (session-exact forking); AI-SDK providers truncate the display only.

1. **Retry the last turn.** After a 2–3 turn conversation, hover the final reply → **Retry**. The
   last question is re-asked, a fresh answer replaces the old one, and the **original line appears
   in History** as its own conversation.
2. **Edit-and-resend.** Hover an earlier user message → **Edit**. The composer enters edit mode
   (accent banner: sending rewinds here; Escape or ✕ cancels and restores whatever draft you were
   writing; button reads **Resend**). Change the text and Resend.
3. **Context retention.** In the edited re-run, verify the reply still knows content from the
   _kept_ earlier turns (proves the session was forked at the anchor, not restarted) and shows no
   knowledge of the discarded turns.
4. **The original is intact.** Open the preserved original from History and continue it — its own
   session still works; both lines coexist.
5. **Branch after restart.** Restart the app, reopen a conversation, edit-and-resend — anchors are
   persisted with the items, so branching must still fork correctly.
6. **First-message edit.** Edit the very first user message — nothing is kept, so the branch runs
   on a fresh session (no stale context should leak).

### #248 — Multimodal composer (images)

1. **Paste.** Take a screenshot to the clipboard (⌘⇧⌃4), paste into the composer on Claude: a
   thumbnail chip appears (✕ removes it). Send _"What's in this screenshot?"_ — the image renders
   above your bubble and the answer proves the model saw it.
2. **Drag-drop.** Drop a PNG from Finder onto the composer — same behaviour.
3. **Compose-time rejection.** Switch to **Ollama** and paste an image — no chip; a transient hint
   (_"The selected provider does not accept images."_). Also try a >4 MB image and an `.mp4` —
   each gets its own hint. Nothing ever fails at run time.
4. **Caps.** Attach 4 images, then a 5th — hint, no fifth chip.
5. **Persistence.** Reopen the conversation from History — image previews survive on the message.
6. **Interplay.** Send an image mid-run — it queues (steering is text-only). Edit-and-resend an
   image message — the images ride along. Retry an errored image turn — images are resent.

---

## Wave 5 — composer and context

### #249 — Context controls: attach/detach parity + selection

1. **Ribbon.** In an agent tab: **Attach File** and **Add Folder** open pickers and produce
   composer chips. Select some code in an editor first, then **Attach Selection** — a chip labelled
   like `main.ts — selection #1 (12 lines)` with the selection icon. **Clear Context** is disabled
   while nothing is attached, enabled otherwise, and removes every chip.
2. **Tool strip.** In a docked panel (code/markdown/terminal tab), the tool strip's attach
   file/folder/selection buttons do the same; chips render in the same composer and stay in sync
   with ribbon-driven state.
3. **Selection reaches the model.** Attach a selection, then ask about it **without naming the
   file** (_"What does the attached selection do?"_) — the text is inlined into the prompt, so
   this works on **every** provider, including Ollama.
4. **Meter estimate.** Attaching a selection shows the context meter immediately with a `≈` prefix
   (estimate ≈ chars/4); the tooltip itemises the pending-selection estimate. Path attachments
   show up in the meter only via the next turn's real usage.
5. **AI-SDK path fix.** On Ollama, attach a _file_ and ask what's attached — the path list must
   reach the prompt (before #249 attachments never reached AI-SDK prompts at all).
6. **Last-active editor.** Focus the agent tab (blurring the editor) before pressing Attach
   Selection — it must still capture the last-active code editor's selection.

### #250 — Slash commands, prompt library, @-mentions

1. **`/` popup.** Type `/` as the first character: a popup lists `/compact`, `/clear`, `/mode`,
   any library prompts, and _Manage prompts…_. ArrowUp/Down move the highlight, Enter/Tab accept,
   Escape closes. Clicking a row works without the textarea losing focus. Typing `/comp` filters.
2. **Built-ins.** `/compact` summarises the conversation; `/clear` starts a fresh one; `/mode`
   toggles Agent/Chat (check the ribbon's Mode field follows).
3. **Prompt library.** Via _Manage prompts…_, save a prompt (name is slugified, e.g. `Code Review!`
   → `code-review`; saving an existing name overwrites). `/code-review` then inserts its text at
   the token. Delete works. **Restart the app** — the library survives.
4. **`@`-mentions.** Type `@` anywhere in the draft with a workspace open: a fuzzy file picker
   appears (gitignore-aware). Type a few characters of a filename — basename-prefix matches rank
   first. Accepting attaches the file as a **context chip** and leaves `@basename ` in the draft;
   send and confirm the agent can read the file.
5. **Non-interference.** With no popup open: ArrowUp still recalls prompt history, Enter still
   sends, Escape still cancels edit mode. A `/` mid-sentence must **not** open the command popup
   (only at the start of the draft); `@` opens anywhere.

### #251 — Wall-clock budget + elapsed indicator

1. **Setting.** Settings → AI shows **Run time limit** (minutes), default **10**, 0 allowed (off).
2. **Elapsed readout.** Start any run — an accent `m:ss` readout ticks beside the word count in
   the composer header, and disappears when the run ends.
3. **Clock pauses on prompts.** Trigger a permission prompt (or `ask_user` question) mid-run — the
   readout **holds, dims, and shows ⏸** (tooltip: _"Run clock paused while the agent waits for
   you"_). Answer — it resumes from where it held. Time spent deciding must not count.
4. **Timeout.** Set the limit to 1 minute and give the agent something slow (a long exploration on
   Ollama works well). At ~1:00 of _active_ run time the run stops and lands as the **structured
   error card**: _"The run exceeded its 1-minute time limit and was stopped."_ — with provider
   readout and a working **Retry**. Reset the setting afterwards.
5. **Off.** Set the limit to 0 — a long run is never time-aborted.

### #252 — Sub-agent lane polish (visual)

Run the #239 sub-agent prompt again and judge the presentation:

1. **Rail glyph.** A settled Task row wears the **robot** glyph — distinct from the lightning of
   ordinary tool chips (spinner while running, warning on failure, unchanged).
2. **Summary line.** Accent edge on the chip's left; robot icon; **bold** title; `·`-separated
   live status (capitalised **Done**/**Failed** when settled) and small mono tools/tokens meta.
3. **Lane body.** Expanded content sits inset behind a thin sub-rail line, in **prose** type (only
   the technical input line and tool details are mono); nested tool rows have centred state icons
   with an accent spinner while live; the sub-agent's text renders as small surface bubbles.
4. **Hierarchy check.** In one transcript, compare side by side: an ordinary tool chip, a thinking
   disclosure, and a lane — the three must be distinguishable at a glance.

---

## Cross-cutting regression sweeps

Quick passes worth running after any change to the agent subsystem:

- **Provider matrix.** Send one tool-using prompt per provider (Claude, Vercel, Ollama) per mode
  (Agent, Chat) and confirm gating, transcripts, and usage readouts behave identically.
- **Persistence sweep.** Build one conversation exercising everything persistable — question,
  lane, thinking, tool detail, error card, images, queue — restart the app, reopen it from
  History, and confirm each item restored sensibly (pending states dismissed, everything else
  intact and expandable).
- **Compaction.** `/compact` a rich conversation — the transcript collapses to one summary, the
  context meter drops to zero and refills on the next turn, and attached images/tool payloads do
  not bloat the summary run.
- **Interrupt sweep.** Press Stop during: streaming text, a running tool, a pending permission, a
  pending question, and a staged edit preview. Every pending state must settle visibly (nothing
  stuck), and the requests bell must clear.
