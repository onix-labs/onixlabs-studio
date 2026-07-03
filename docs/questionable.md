# Questionable docs — for review

Content pulled out of the old `docs/*.md` during the consolidation into `agents.md`. Each item is
here because I **could not verify it is still accurate**, or because I made a judgement call you may
want to confirm. Resolve each: fold the still-true parts into `agents.md`, or delete.

The four source docs (`arch-refactor.md`, `code-quality.md`, `agent-access-model.md`,
`source-control-integration.md`) were removed; their durable content is now in `agents.md`, and the
`arch-refactor.md` migration progress-log / sequencing / return-prompts were discarded as complete
(they remain in git history).

---

## 1. Git integration status & remaining work (from `source-control-integration.md`)

The **architecture** (provider adapter, `GitProvider`, main-process git CLI, workspace-vs-repository
git) is durable and is now in `agents.md §6`. What I dropped is the **status/handoff**, which was
written on the `feature/git-integration` branch and predates the whole feature-first refactor — the
paths it cited (`src/electron/git-manager.ts`, `src/shared/ipc-channels.ts`, `studio-api.ts`,
`window.studio.sourceControl`, `components/views/source-control-view`) **no longer exist**. Verify
which of the following is still true before keeping any of it:

- **Slice status:** slices 1–4 (read-only, local mutations, workspace decorations, branch ops) were
  marked done; slices **5 (network `fetch`/`pull`/`push`), 6 (ribbon cross-view + tab dedup +
  workspace commit panel), 7 (docked agent + terminal panels)** were "implemented, green, but not yet
  committed." Are these now shipped? (The dock/panel and tab-dedup parts clearly are, post-refactor.)
- **Remaining work:** (a) **Discard changes** — per-file revert in the commit panel, needs a
  destructive confirm dialog (`git restore --staged --worktree` for tracked, delete for untracked).
  (b) **In-app auth** — network ops currently lean on the user's git credential helper + ssh-agent and
  fail fast when absent (`GIT_TERMINAL_PROMPT=0`); failures surface via stderr but not in a rich error
  UI. Both were "later follow-ups." Still open?
- **GitHub tickets #96–#99** — flagged as predating the current design, no milestone, needing
  re-scope (#97 → the provider abstraction). Have these been reconciled?
- **Known gap:** `WorkspaceGit` had no unit spec. Still true?
- **Test-repo generator** — a `make-git-test-repo.sh` (merge graph, branches, tags, stashes,
  ahead/behind via a bare remote, dirty tree with staged/unstaged/untracked/rename/delete) lived in a
  session scratchpad, **never committed**. If it's still useful, move it to `scripts/`.

---

## 2. AI agent — forward-looking items (from `agent-access-model.md`)

The access & permission model is in `agents.md §5`. These were future/roadmap items tied to issue
numbers I can't verify:

- **In-app tool layer (#142)** — "the concrete in-app capabilities land with #142." Done?
  (`AgentEditorCapabilities` exists today; is #142 complete, or are more capabilities pending?)
- **Per-tool / per-capability default policies surfaced in Settings (#112)** — implemented?
- **v0.5+ hardening** (listed as future): confine machine writes to the workspace root as
  defence-in-depth (SDK `additionalDirectories` / sandbox) beyond per-action consent; an **audit log**
  of granted actions. Still planned / done / dropped?

---

## 3. Corrections I made vs the old design doc — please confirm

`arch-refactor.md` was a **planning** document; a few details in it diverged from what was actually
built. I wrote `agents.md` to describe the **as-built** reality, but flag these so you can confirm I
described it correctly (or tell me the doc was right and the code drifted):

- **Electron build output.** The plan (§7) said `main.js`/`preload.js` would move to
  `dist-electron/shared/electron/` and `package.json main` would be repointed. In reality the output
  was **kept at `dist-electron/electron/`** (only the esbuild _inputs_ changed) so `__dirname`-relative
  paths never churned. `agents.md §8` states the as-built version. ✅ (high confidence — matches the
  current `build:main`/`build:preload` scripts.)
- **`FeatureDescriptor` shape.** The plan sketched `{ id, view, ribbon?, chrome?, providers?,
  register?(host) }`. The as-built descriptor is `{ type, view, ribbon?, documentPanel?, chrome? }` —
  no `providers`/`register(host)`; feature-scoped providers + eager glue live in the feature's
  `provide<F>Feature()` via `makeEnvironmentProviders`. `agents.md §4.1` uses the as-built shape.
- **Dock seam.** The plan (§4 seam 2) had features contribute panels imperatively via
  `register(host)`. As built, a tab provides a `DockBlueprint` (declarative `createLayout()` + `panels[]`)
  through the `DOCK_BLUEPRINT` token. `agents.md §4.2` describes the as-built blueprint.

---

## 4. Dropped migration procedure — keep only if more large relocations are planned

`agents.md §8` keeps a **condensed** relocation recipe (still useful for ongoing feature work). I
dropped the migration-specific detail below as largely spent now that `src/` = `features` + `shared`.
Recover any of it if you expect more big moves:

- The **"blind spots that bit the markdown pass"** war-story: gate-check greps miss sibling-form
  imports (`../<x>/<x>` with no `services/` segment — e.g. `agent-editor-capabilities → ../markdown-commands`)
  and **inbound** edges (a document well embedding a feature's view). The reusable lesson — always grep
  the sibling form `from '[^']*/<x>/<x>'` **and** the selector/class for inbound edges — is folded into
  `agents.md §8`.
- The full **§10 progress log** (every kitchen move and feature stand-up, commit-by-commit, with the
  running baseline). Discarded — it's a complete history, preserved in `git log` and in the project
  memory. Recover from git if a narrative of the migration is ever wanted.
