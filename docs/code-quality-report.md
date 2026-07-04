# ONIXLabs Studio — Code Quality Report

> **Overall quality score: 88 / 100** — _Very good; a disciplined, convention-strong codebase with
> concentrated, well-understood debt._
>
> **⟳ Remediation complete (2026-07-04):** the P0–P3 roadmap in §10 has been executed. Most of the identified
> debt is paid down (both cross-feature leaks, the dead code, DRY clusters 1–2, three of the four god-files,
> the Memento pattern, and the two grab-bag splits); P3b's component/service merges were **consciously
> declined**. See the annotated table and the [Remediation outcomes](#remediation-outcomes-2026-07-04) in §10.

**Repository:** `onixlabs-studio` (Angular 22 + Electron desktop IDE)
**Commit reviewed:** `c99011e` (findings) · outcomes annotated as of the P0–P3 work on `main`
**Date:** 2026-07-04 (report) · 2026-07-04 (outcomes)
**Standard applied:** the project's own `docs/agents.md` (§7 conventions + §2 architecture invariants).

---

## How this report was produced

This review is **graph-backed**. The `/understand` knowledge graph (`.understand-anything/knowledge-graph.json`
— 817 nodes, 1,650 edges, 7 architectural layers) provided the hard, quantitative backbone:
import-edge analysis for architecture invariants, multi-type-file counts, fan-in/coupling hotspots and
LOC hotspots. Four specialist review agents then read the actual source to produce file-and-line-anchored
qualitative findings, each judged against `docs/agents.md` rather than a generic standard.

**Scope:** the 518 production files under `src/` (296 TypeScript + 209 component HTML/SCSS + 7 config
+ 2 docs). The **168 `*.spec.ts` test files were excluded** from graph analysis; their _presence_ is
noted as a positive for testing discipline, but their contents were not deep-reviewed here.

**Verdict in one paragraph.** ONIXLabs Studio is an unusually disciplined codebase. Its conventions are
_realised_, not aspirational: `any` is effectively absent (1 match, and it's a comment), explicit member
accessibility / `readonly` / explicit return types are pervasive, floating promises are lint-guarded, and
the feature-plugin architecture holds almost perfectly. The debt is **concentrated and legible**: four
god-files, a handful of duplication clusters, ~450 lines of dead scaffolding, two cross-feature import
leaks, and one high-value missing pattern (undo/redo). None of it is systemic; all of it is cheap to pay
down _before_ the next feature wave.

---

## Table of contents

1. [DRY — duplication & componentisation](#1--dry--duplication--componentisation)
2. [YAGNI — code we don't need](#2--yagni--code-we-dont-need)
3. [OOP-first / FP-where-it-fits](#3--oop-first--fp-where-it-fits)
4. [SOLID principles](#4--solid-principles)
5. [GoF design patterns](#5--gof-design-patterns--what-would-help)
6. [One-type-per-file (Java-style)](#6--one-type-per-file-java-style-structure)
7. [Architecture shape](#7--architecture-shape--is-it-correct)
8. [Directory breakdown of `src/*`](#8--directory-breakdown-of-src)
9. [Quality score (/100)](#9--quality-score--100)
10. [Prioritised remediation roadmap](#10--prioritised-remediation-roadmap)
11. [Keeping the knowledge graph in sync](#11--keeping-the-knowledge-graph-in-sync)

---

## 1 — DRY — duplication & componentisation

**Assessment: Good, with 5 concrete clusters.** The house style (explicit typed members + per-member
TSDoc) legitimately inflates line counts, so this review separates **harmful structural duplication**
(where a base/factory/generic component removes real maintenance burden) from **framework-mandated
boilerplate** (input/output plumbing Angular requires — _not_ a DRY violation).

| # | Cluster | Severity | Files | Fix |
|---|---------|----------|-------|-----|
| 1 | **Insert-modals** | **HIGH** | `features/markdown/.../insert-modals/{link,math,footnote,collapse,image}-modal.ts` | Content-projecting `<app-form-modal>` shell owning the `confirm→validate→emit→reset→close` lifecycle; each modal supplies only its fields + a `valid` signal. ~5×140 → ~5×40 LOC. |
| 2 | **Ribbon `:host` SCSS** | **HIGH (trivial)** | all 6 `features/*/angular/*-ribbon/*-ribbon.scss` | Identical 5-line `:host{display:flex;flex:1;…}` copied 6× (each with a comment admitting it's a copy). Replace with a `RibbonHost` `hostDirective` — sidesteps the `styleUrl`-can't-use-aliases limit (agents.md §8) that caused the copies. |
| 3 | **Single-handler command buses** | MED | `terminal-commands.ts`, `source-control-commands.ts`, `workspace-source-control-commands.ts` (+ keyed variants `editor-commands.ts`, `markdown-commands.ts`) | Identical `handler` signal + `register`/`unregister` + `hasActive` scaffold (~40% of each small file). Extract `SingleHandlerCommandBus<T>` / `KeyedHandlerCommandBus<T>` bases in `@shared`. Keep typed forwarders (house rule wants explicit members). |
| 4 | **Ribbon button ≈ small-button** | MED | `components/ribbon-strip/{ribbon-strip-button,ribbon-strip-button-small}` | Same 6 inputs + output + `onClick`; templates differ only by class name and icon size (1.5 vs 1). Merge into one `size`-driven control. |
| 5 | **text-field ≈ password-field** | LOW–MED | `components/forms/{text-field,password-field}` | Near-identical (password-field's own doc says _"mirrors TextField"_); differ only by input `type` and a latent change-vs-input event inconsistency. Merge with a `type` input; settle on the `input` event. |

**Correctly _not_ flagged (cleared):** per-domain bridge clients (the prescribed §4.3 seam — only a
2-line preamble repeats; over-abstracting would hide the typed per-domain APIs), feature-ribbon TS
delegation methods (registry design, one meaningful line each), and the status services (they already
share the `StatusBar` abstraction). This restraint is correct — not all similarity is duplication.

**Higher-level abstraction summary:** the payoff pattern is _"lift the invariant scaffold into `@shared`,
keep the per-instance specifics local."_ Clusters 1–3 each move a repeated **lifecycle** (modal
open/validate/close; command register/dispatch) into a shared base or shell; clusters 4–5 collapse
size/type variants of one control into a single parameterised component.

---

## 2 — YAGNI — code we don't need

**Assessment: Disciplined, with specific, grep-verified removals.** No commented-out code, no
`//`-comment TODOs, no dead config keys beyond the one below, and — importantly — the documented
extension seams are **not** YAGNI (see below). The dead code that exists is legible leftover scaffolding.

| Finding | Location | Evidence | Action |
|---------|----------|----------|--------|
| **Mock git fixtures** (~370 LOC) | `shared/angular/services/repository/repository-data.ts:~406–782` | `SEED_STAGED/UNSTAGED/COMMITS/BRANCHES/REMOTES/TAGS/STASHES` — **zero external consumers** (grep-verified). Source control is now real git via `GitProvider`; these are pre-real-git scaffold. | **Delete the `SEED_*` block.** Rename the surviving type block → `git-types.ts` (it holds no "data" any more). |
| **Dead setting `application.undoStackSize`** | `settings.ts:199,446,486,701`; `settings-registry.ts:39,363` | Registered, exposed as a `Signal<number>`, clamped setter, **user-editable in the UI** — yet **nothing reads it** (grep for `.undoStackSize()` = 0 outside specs). A knob that does nothing. | **Wire it to the undo history** in §5's Memento adoption, or remove until an undo feature exists. |
| **Dead component `Radio` / `app-radio`** | `components/forms/radio/{radio.ts,html,scss,spec.ts}` | Selector `app-radio` in **zero** templates; class referenced only by its own spec. Settings use button-group/dropdown/toggle instead. | **Remove all 4 files** (unless an imminent settings control needs it). |
| **4 dead exports** | `tabs/tab.ts:92` (`CREATABLE_TAB_TYPES`), `dock/dock-node.ts:17` (`DockNodeKind`), `markdown-reader/read-tokenize.ts:80` (`NO_WORD`), `api/task-channels.ts:32` (`TaskOutputStream`) | Each occurs exactly once (its own definition; no consumer). | Remove. |
| **Stub PR/Issue/Action data in production** | `repository/.../source-control-sidebar.ts:212,221,229` | Hardcoded `StubPullRequest[]`/`StubIssue[]`/`StubAction[]` rendered as placeholder sections — fake PRs/issues shown to users. | Feature-flag or hide until a provider is wired. |
| **Untracked TODOs on inert buttons** | `markdown-ribbon.ts:223,357,373`, `code-ribbon.ts:235` | Visible ribbon buttons that do nothing (find, PDF export, task-list); `onFind()` body is empty. Violates agents.md §7 (no `TODO` without `#issue`). | Wire, hide, or convert to `// TODO(#nnn)` + disable the button. |

**Explicitly cleared as _intentional seams_, not YAGNI:** `SourceControlProvider` (SVN later),
`ProjectSystem`/`ProjectSystemRegistry` (npm/Cargo later), `AgentProvider` (Vercel/Ollama already named),
`DockBlueprint`/`DOCK_BLUEPRINT` (two live blueprints), `FeatureRegistry`, `TaskProvider`. These are
documented in `agents.md` and have real or explicitly-planned second implementers — the difference
between a _designed seam_ and a _speculative abstraction_. DI is **not** over-tokenized: exactly **one**
`InjectionToken` exists in the whole tree.

---

## 3 — OOP-first / FP-where-it-fits

**Assessment: Strong — the rule is genuinely followed, not sloganned.** agents.md §7 mandates "OOP
first; reach for FP only where it expresses the problem better," and the code obeys with real judgement:

- **Stateful things are classes.** `Repository`, `Monaco`, `FeatureRegistry`, `ProjectSystemRegistry`,
  `SpellChecker` (owns a dictionary set + first-letter buckets) all hold genuine state behind explicit
  member accessibility.
- **Pure, stateless transforms are free functions using structural sharing** rather than mutation:
  `dock/dock-tree.ts` (`replaceNode`/`removeNode`/`insertBeside` return new trees sharing every untouched
  subtree), `source-control/git-output.ts` (status/log/ref/stash/diff parsers), `review-spell.ts`
  (`boundedLevenshtein`), `monaco.ts:253` (`buildHeuristicSemanticTokens`). All independently unit-testable.
- **No anti-patterns of the kind the guide warns against:** no single-method "class" that should be a
  function (`SourceControlProviders` looks like one but legitimately holds an injected collaborator), and
  no free functions sharing mutable module state.
- **Reactive state is signals/`computed`/`effect` throughout**, consistent with the zoneless model — RxJS
  is reserved for genuine async streams, as the guide requires.

This is a model implementation of the paradigm rule. No action required.

---

## 4 — SOLID principles

**Assessment: Strong overall; SRP is the one principle under strain, isolated to four god-files.**

| Principle | Rating | Evidence |
|-----------|--------|----------|
| **S**ingle Responsibility | **Adequate** | Excellent at module granularity (pure transforms extracted; `main.ts`'s `Program` delegates every OS concern to focused managers). **But four god-files strain it** — see below. |
| **O**pen/Closed | **Strong** | Real, consistently-applied seams: `SourceControlProvider`, `AgentProvider`, `ProjectSystem`+registry, `FeatureRegistry`/`provideFeature`, `DOCK_BLUEPRINT`, data-driven settings registry. The shell renders from a registry via `ngComponentOutlet` with **no `@switch` on tab type**. Adding a feature/backend touches no existing consumer. |
| **L**iskov Substitution | **Strong** | Largely by _avoidance_ — "composition over inheritance" means almost no subtype hierarchies. Interface impls honour contracts uniformly; `SourceControlProviders` is explicitly designed for a test-fake substitution. |
| **I**nterface Segregation | **Strong / Adequate** | Focused role interfaces; `ProjectSystem.loadProjectItems?` is optional so a provider isn't forced to implement what it can't (textbook ISP). **One tension:** `SourceControlProvider` is broad (~18 read+mutate+network methods) — a read-only backend must implement `commit`/`push`. Split into `Readable`/`Mutable`/`Remote` _before_ the second backend lands. |
| **D**ependency Inversion | **Strong** | `inject()` is universal; consumers depend on abstractions (a `SourceControlProvider` from an injected factory; the generic `Bridge`). **One architectural leak:** the two cross-feature imports depend on a concrete sibling feature — see §7. |

### The four god-files (SRP decomposition targets)

| File | LOC | Responsibilities crammed together | Decomposition |
|------|-----|-----------------------------------|---------------|
| `markdown-view/markdown-view.ts` | **1270** | command-handler assembly + 4 clipboard variants + outline scroll-spy + review reveal/flash + read-along highlighting + panel splitter — **6 responsibilities**. | Keep `MarkdownView` as a thin orchestrator; extract `OutlineScrollSpy`, `MarkdownClipboard`, `ReviewReveal`, `ReadAlongHighlighter`, and a `buildMarkdownCommandHandler(pane)` factory. |
| `settings/settings.ts` | **995** | generic reactive override engine + ~40 backwards-compat named accessors + legacy nested→flat migration — **3 roles**. | `Settings` (engine) + `SettingsFacade` (compat accessors, or retire) + `SettingsMigration` (unit). |
| `lsp/lsp-client.ts` | **1016** | document-sync + session lifecycle + LSP→Monaco marker mapping + path/URI utilities. | Pure `lsp-paths` module + `LspDiagnosticMapper` + `LspSessionManager`; `LspClient` becomes just document-sync. |
| `monaco/monaco.ts` | **772** | loader bootstrap + worker env + theme defs + language tables + heuristic semantic-token provider. | _Lower priority_ — cohesive to "configure Monaco"; optionally hive off `defineThemes` + the token provider. |

**Minor documentation slips (agents.md §7 "every member documented"):** `documents.ts:457` `saveActive()`
is undocumented (its TSDoc block was orphaned above `openFileInfo` during an edit); malformed TSDoc
closers at `documents.ts:166,170,174–176,278`.

---

## 5 — GoF design patterns — what would help

**Assessment: The codebase is well-patterned, not under- or over-patterned.** It already applies the
right structural/creational patterns _deliberately_ and documents the intentional ones:

| Pattern (in use) | Where |
|------------------|-------|
| Strategy | `ai/agent-provider.ts`, `source-control/source-control-provider.ts`, `project-system/project-system.ts` |
| Adapter | `git-provider.ts` (git-CLI→provider), `dotnet-project-system.ts` (MSBuild→provider) |
| Factory | `source-control-providers.ts`, `default-project-systems.ts` |
| Registry | `feature-registry.ts`, `dock-panel-registry.ts`, `ProjectSystemRegistry`, `Tasks` |
| Composite | `dock-node.ts` (recursive `SplitNode`/`StackNode`) + pure `dock-tree.ts` ops |
| Observer | Angular signals throughout |
| Flyweight-ish | `icons/icon.ts` static descriptor registry |

### Recommended adoption — **Memento** for undo/redo + layout persistence (TOP recommendation)

**Problem:** `DockState` (`dock/dock-state.ts`) replaces an immutable `DockNode` tree on every op
(`tabInto`, `splitStack`, `dockEdge`, `movePanel`, `setSizes`, …) but has **no undo and no persistence**
(grep for `serialize|localStorage|toJSON|restoreLayout` = nothing). An accidental panel close or mis-drag
is irreversible, and the whole arrangement is lost on restart.

**Why it fits with near-zero ceremony:** the tree is _already_ an immutable, structurally-shared value —
a memento is literally a captured `DockNode` reference (no deep-clone). Add a bounded `past`/`future`
stack to `DockState`, push before each mutating `this.tree.set(...)`, expose `undo()`/`redo()` +
`canUndo`/`canRedo` signals. The **same** captured tree, through a trivial JSON codec, also gives
**layout persistence across restart** — one mechanism, two long-expected IDE wins. It also **consumes the
dead `undoStackSize` setting** (§2), closing a YAGNI gap. Effort ≈ ½ day; isolated to the dock package.

### Deliberately rejected (pattern-astronautics)

- **Broad Command-with-undo across the `*-commands` buses** — they are thin handler-routers delegating
  undo to Monaco/Milkdown's built-in history; git `fetch`/terminal `clear`/text edits are non-undoable or
  externally side-effecting. Reifying them buys ceremony, not capability. (The _one_ place command-history
  is justified — reversible app-owned ops like dock layout and future file rename/delete — is covered by
  the Memento caretaker above.)
- **Formal Builder** for dock layout (the functional `createLayout`/`mkStack`/`mkSplit` already reads
  clean), **Chain of Responsibility** for the two-bucket AI `canUseTool` gate, new **Mediator** or
  **Abstract Factory**. All would add ceremony without benefit.

_Optional quality-only:_ a generic `CommandRouter<THandler>` (Template Method) to DRY the five command
routers — same as DRY cluster 3.

---

## 6 — One-type-per-file (Java-style structure)

**Answer: No, the codebase is not one-type-per-file — and it should _not_ blanket-adopt it.** But the
largest multi-type files _are_ worth splitting for navigability.

**The data (294 non-spec `.ts` files, counting exported top-level `class`/`interface`/`enum`/`type`):**

| Exported top-level types in file | Files | Interpretation |
|---|---|---|
| 0 | 39 | barrels, `*.feature.ts` providers, const-only modules |
| 1 | **172 (58%)** | already one-type-per-file |
| 2 | 41 | mostly cohesive (`*-channels.ts` = enum + payloads + client iface) |
| 3–4 | 31 | domain clusters |
| 5+ | 11 | **navigability risk** |

**Worst offenders:** `settings.ts` (23 types), `api/ai-types.ts` (21), `repository-data.ts` (14),
`settings-registry.ts` (12), `api/lsp-channels.ts` (9), `dock/dock-node.ts` (7).

**Recommendation — targeted, not dogmatic:**

- **Keep** the `*-channels.ts` co-location (channel enum + payload interfaces + client interface for one
  domain). That's _high cohesion_, the opposite of a smell — Java's one-type rule would fragment a single
  logical IPC contract across a dozen files for no gain. agents.md §4.3 prescribes this shape.
- **Split** the genuine grab-bags where the types are only loosely related and the file is a navigation
  hazard: `ai-types.ts` (21) → per-concern type modules; `repository-data.ts` (14, and it's mostly dead —
  see §2) → `git-types.ts`; and the god-file `settings.ts` split (§4) naturally separates its DTO types.
- **Adopt as a soft convention** for _new_ code: "one primary exported class/component per file; group only
  tightly-cohesive supporting types beside it." This is already true for 58% of files and matches the
  kebab-case-file house style without importing Java ceremony.

Net: this is a low-severity, high-navigability-payoff cleanup concentrated in ~11 files, not a
codebase-wide refactor.

---

## 7 — Architecture shape — is it correct?

**Answer: Yes — the shape is correct and well-suited.** It is a **feature-plugin architecture over a
shared platform**, and it holds almost perfectly.

### The rationale (and why it's sound)

`src/` is exactly two subtrees:

- **`src/shared/{angular,api,app,electron}` — the "kitchen":** every reusable ingredient — UI atoms + the
  four capability wrappers (`<app-terminal>`, `<app-text-editor>`, `<app-markdown-editor>`, `<app-agent>`),
  cross-cutting `@Service()` singletons, the generic IPC bridge + per-domain channel contracts, **all**
  main-process code, and the composition root (`app`).
- **`src/features/<feature>/{angular,electron,api}` — the "recipes":** eight deletable leaf plug-ins
  (`workspace`, `repository`, `code`, `markdown`, `terminal`, `agent`, `settings`, `welcome`) that compose
  kitchen parts into a tab view + ribbon + commands + status glue.

Two **invariants** keep it honest, enforced by four runtime seams (feature-registry, `DOCK_BLUEPRINT`,
the generic bridge, path aliases) that make the shell genuinely feature-blind — it never switches on tab
type:

- **INV1 — no feature code in `shared`** (only `shared/app`, the composition root, may name features).
- **INV2 — features are isolated plugins** — a feature imports only `@shared/*` and its own
  `@features/<self>/*`, never a sibling feature. Deleting a feature folder + one `config.ts` line removes
  it cleanly.

**Against the alternatives it wins:** layered architecture smears one feature across every tier (add/remove
touches all layers); plain NgModule feature-modules give lazy-loading but no hard isolation; Nx libs are
the industrial version of _exactly this shape_. This repo is effectively **Nx-lite** — it achieves ~90% of
Nx's enforced module boundaries with just tsconfig aliases + documented invariants.

### The one structural weakness — enforcement by convention, not lint

The graph confirms **INV1: 0 violations** ✅ but **INV2: 2 violations** ⚠️ — the direct symptom of no lint
rule:

| # | Violation | Why it exists | Fix (relocation only, has precedent) |
|---|-----------|---------------|--------------------------------------|
| 1 | `features/agent/.../agent-editor-capabilities.ts:4` → `@features/markdown/.../markdown-commands` | Agent reads the **code** editor via the _shared_ `EditorCommands` registry but the **markdown** editor via the _feature-owned_ `MarkdownCommands` — pure asymmetry (identical seams, one promoted, one not). | **Promote `MarkdownCommands` → `@shared/angular/services/markdown-commands`** (mirrors `EditorCommands`; it's plumbing for the shared `<app-markdown-editor>`). |
| 2 | `features/workspace/.../directory-view.ts:49` → `@features/repository/.../commit-detail` | Workspace's dock reuses repository's `CommitDetail` panel. Its data-service `Repository` is _already_ shared; the component just didn't follow its data. | **Promote `CommitDetail` → `@shared/angular/components/panels`** (matches §6, where diff panels are already shared). |

Both fixes are pure promotions to `@shared` with no logic change and existing precedent. **The single
highest-value hardening is to make the invariant self-policing** — add an ESLint `no-restricted-imports` /
`dependency-cruiser` rule banning sibling-`@features` imports (see §10). That converts "documented
convention" into "mechanically enforced boundary" and prevents regression.

### Other shape observations

- **`shared/angular/components` (192 files) is _not_ a monolith** — already sub-grouped into ~20 cohesive
  folders (`dock`, `forms`, `strips`, `ribbon-strip`, `panels`, + the 4 capability wrappers). Healthy.
- **Capability wrappers are genuinely feature-agnostic** and each wraps exactly one engine (§3). Sound.
- **`shared/app` stays minimal** (7 files, composition-root only). Good.
- **Nothing in `shared` is truly feature-specific** — the feature-named-looking services
  (`repository`/`source-control`/`diffs`, `agent`/`ai-runtime`) are consumed by ≥1 feature and justify
  their place. `welcome-modal` is a borderline _name_ (a rename to `welcome-overlay-state` removes the
  smell) but not a misplacement.
- **Feature-owned `electron`/`api` is declared but unexercised.** Every feature is `angular/`-only; **100%
  of main-process code and IPC contracts live in `shared`** — by design (§3: a feature "owns little-to-no
  unique electron/api"). Worth stating explicitly: the per-feature `electron/`/`api/` slots are aspirational
  headroom, not a defect.

---

## 8 — Directory breakdown of `src/*`

### Features (all `angular/`-only; 0 feature `electron/` or `api/` dirs)

| Directory | Files | What lives here / why | Better home? |
|-----------|-------|-----------------------|--------------|
| `features/agent` | 8 | `<app-agent>`-hosting tab view + ribbon; `agent-editor-capabilities` registers read/replace-active-document AI capabilities (§5). | Keep. Fix INV2 #1 by promoting `MarkdownCommands` to shared (don't move agent). |
| `features/code` | 25 | Monaco `code-view` (+ agent/terminal panels), `code-ribbon`, `code-document(-panel)`, `code-runner`, `code-agents`, `code-status`, `change-margin` (dirty-diff gutter). Composes `<app-text-editor>`. | Keep. |
| `features/markdown` | 42 | Largest feature: `markdown-view` (+ outline/reader/review/agent panels), full `markdown-ribbon` (+ `insert-modals`), `markdown-commands`, `-reader`, `-review`. | Keep view/ribbon. **Promote `markdown-commands` → `@shared`** (fixes INV2 #1). Split `markdown-view` god-file (§4). |
| `features/repository` | 18 | `source-control-view` + panels `commit-graph`, **`commit-detail`**, `source-control-sidebar`; ribbon, commands, `REPOSITORY_DOCK_BLUEPRINT`. (VCS _services_ are shared per §6.) | Keep most. **Promote `commit-detail` → `@shared/.../panels`** (fixes INV2 #2). Feature-flag the stub PR/issue data (§2). |
| `features/settings` | 19 | Full-bleed `settings-view` (opts out of ribbon+status via chrome): `sections/`, `setting-control`, `editor-profiles`. Consumes shared `settings`/`settings-store`. | Keep. |
| `features/terminal` | 14 | `terminal-view`, ribbon, commands, status, `terminal-agents`, `agent-terminal-capabilities`. Composes `<app-terminal>`. | Keep. |
| `features/welcome` | 4 | `welcome-screen` + `recent-items`. Shell-slotted (mounted by `root`, no registry descriptor). | Keep. |
| `features/workspace` | 23 | The `directory` (IDE) tab: `directory-view` (own dock, `WORKSPACE_DOCK_BLUEPRINT`), ribbon, `panels/` (output/problems/solution/tree), `project/` (`SolutionModel`), `workspace-git` (lightweight status decorations §6). | Keep. Fixed by promoting `CommitDetail` (don't move workspace). |

### Shared

| Directory | Files | What lives here / why | Better home? |
|-----------|-------|-----------------------|--------------|
| `shared/angular/components` | 192 | UI atoms + capability wrappers, sub-grouped into ~20 folders (`dock`, `ribbon-strip`, `strips`, `forms`, `panels`, `menu`, `modal`, `tree-view`, `diff-editor`, `content-host`, …). | Keep. Landing zone for promoted `commit-detail` (→ `panels/`). Remove dead `forms/radio` (§2). |
| `shared/angular/services` | 80 | ~45 cross-cutting `@Service()` singletons: capability plumbing (`monaco`, `milkdown`, `terminals`, `documents`, `editors`, `editor-commands`), AI stack, VCS renderer layer (§6), runtime seams (`feature-registry`, `dock`, `tabs`, `status-bar`), infra (`lsp`, `diagnostics`, `file-*`, `workspace(s)`, `settings`, `theme`, …). | Keep. `welcome-modal` → optional rename `welcome-overlay-state`. Split god-files `settings`/`lsp-client` (§4). |
| `shared/angular/milkdown` | 10 | Milkdown/ProseMirror plugin ports (mermaid, github-alert, emoji, footnote, …) — plumbing for `<app-markdown-editor>`. | Keep. |
| `shared/angular/styles` | 13 | Global SCSS (`_theme*`, `_variables`, `_base`, `_menu`, `_change-margin`, `styles.scss`, …). | Keep. |
| `shared/angular/icons` | 1 | `icon.ts` — Phosphor icon token/registry (fan-in 67, most depended-upon module). | Keep. |
| `shared/api` | 17 | The generic `bridge.ts` (sole IPC contract) + `host.ts` + 13 domain `*-channels.ts` + `project-system.ts`, `ai-types.ts`. Names no feature. | Keep — exemplary; this is the seam that keeps `shared` feature-blind. Split `ai-types.ts` (21 types, §6). |
| `shared/app` | 7 | Composition root: `config.ts` (feature enumeration — INV1 exception), `main.ts`, `global.d.ts`, `index.html`, `root/`. | Keep. Minimal, correct. |
| `shared/electron` | 33 | All main-process code: `main.ts`, `preload.ts`, managers (git/file/terminal/task/workspace/security/…), `ai/` (12 — providers + manager + auth + renderer-bridge + tools), `lsp/` (4), `project-system/` (3). | Keep. Clean sub-grouping. Note: no feature owns any of this (by design). |

---

## 9 — Quality score / 100

**Score: 88 / 100.** The rubric is deliberately **ratio-based** (adherence %, violation counts,
dead-code density) so that _adding a well-formed feature does not move the number_ — see the
score-preserving contract below.

| Dimension | Weight | Sub-score | Weighted | Rationale |
|-----------|-------:|----------:|---------:|-----------|
| Architecture & module boundaries | 20 | 90 | 18.0 | Shape excellent & Nx-lite; −2 cross-feature violations; enforcement is convention not lint. |
| SOLID principles | 15 | 85 | 12.75 | OCP/DIP/LSP/ISP strong; SRP strained by 4 god-files. |
| DRY / componentisation | 12 | 80 | 9.6 | Mostly clean; 5 clusters (2 high-payoff). |
| YAGNI / dead-code hygiene | 10 | 82 | 8.2 | Disciplined; ~450 LOC dead + dead component + dead setting + stub data. |
| OOP-first / FP balance | 10 | 95 | 9.5 | Paradigm rule genuinely followed. |
| Type-safety & house conventions | 13 | 96 | 12.48 | No `any`, explicit accessibility/return types, `readonly`, no floating promises. |
| Documentation (TSDoc + agents.md) | 8 | 88 | 7.04 | Pervasive TSDoc + superb agents.md; −doc drift (Angular 20 vs 22), a few orphaned blocks, untracked TODOs. |
| Design-pattern appropriateness | 7 | 88 | 6.16 | Right patterns, not over/under-engineered; one high-value pattern (undo/redo) missing. |
| Testing discipline | 5 | 80 | 4.0 | 168 spec files + TDD/FIRST convention present (not deep-reviewed here); known baseline failures. |
| **Total** | **100** | — | **≈88** | |

**Where the 12 points are, and the path to ~95+:**

- **+3** — fix the 2 cross-feature violations **and add the boundary lint rule** (Architecture → 95+).
- **+3** — decompose the 4 god-files (SOLID/SRP → 92+).
- **+2** — clear the dead code (YAGNI → 95+): mock fixtures, `Radio`, dead exports, dead setting, stub data.
- **+2** — the top DRY clusters (insert-modals shell, ribbon `hostDirective`, command-bus base).
- **+1** — adopt the Memento (undo/redo + persistence), consuming `undoStackSize`.
- **+1** — doc hygiene: fix the Angular-20→22 drift in agents.md, repair orphaned TSDoc, track the TODOs.

### The score-preserving contract (add features without dropping the score)

The number stays near 100 as the codebase grows **iff** each new feature/enhancement:

1. **Respects the invariants** — imports only `@shared/*` and its own `@features/<self>/*` (the lint rule
   in §10 makes this automatic).
2. **Stays one-responsibility** — no new file crosses ~500 LOC / ~5 responsibilities without decomposition;
   reuse shared atoms/wrappers instead of re-implementing.
3. **Carries the house style** — explicit accessibility + total type annotations (no `any`) + per-member
   TSDoc + explicit return types + no floating promises.
4. **Ships zero dead code** — no stub data in production, no editable settings without a reader, no
   untracked TODOs.
5. **Adds a registry descriptor + one `config.ts` line** — never a shell `@switch` on feature type.

Because every rubric dimension is a _ratio_, a feature that meets this contract is score-neutral; the only
way the number falls is by importing debt.

---

## 10 — Prioritised remediation roadmap

Ordered by payoff-to-effort. All are pre-feature-wave cleanups; none is a rewrite.

> **Status update (2026-07-04): P0–P3 executed.** The **Status** column and the
> [Remediation outcomes](#remediation-outcomes-2026-07-04) subsection below record what shipped, what was
> deliberately declined, and what remains. In short: P0 done; P1 done (with two intentional keeps); P2 done
> (three of four god-files — `monaco.ts` was flagged optional and left); P3a/P3c done; **P3b (the component/
> service merges) consciously declined** in favour of keeping distinct UI components and services separate.

| Pri | Action | Type | Effort | Status |
|-----|--------|------|--------|--------|
| **P0** | Add the **boundary lint rule** (`dependency-cruiser` or ESLint `no-restricted-imports`: a feature may import `@shared/*` + its own `@features/<self>/*`, never a sibling). Makes INV2 self-policing. | Enforcement | ~2h | ✅ **Done** — `eslint.config.js` enforces INV1/INV2. |
| **P0** | Fix the **2 cross-feature violations** — promote `MarkdownCommands` and `CommitDetail` to `@shared` (pure relocation; precedent exists). | Relocation | ~½ day | ✅ **Done** — both now under `@shared`. |
| **P1** | Delete **dead code**: `SEED_*` fixtures (~370 LOC), `Radio` component, 4 dead exports, wire-or-remove `undoStackSize`, feature-flag the stub PR/issue data, convert/hide the 4 untracked-TODO buttons. | Deletion | ~½ day | ✅ **Done, 2 intentional keeps** — `SEED_*` + dead exports deleted; **`Radio` kept** (slated for use); **`undoStackSize` kept and now consumed by the P2 Memento**; stub PR/issue data + TODO buttons left pending issue numbers. |
| **P1** | **DRY cluster 1 + 2** — `<app-form-modal>` shell for insert-modals; `RibbonHost` `hostDirective` for the 6 ribbon `:host` copies. | Refactor | ~1 day | ✅ **Done** — `form-modal` + `ribbon-host` shipped. |
| **P2** | **Decompose the god-files** in priority order: `markdown-view.ts` → 1 orchestrator + 5 units; `settings.ts` → engine/facade/migration; `lsp-client.ts` → paths/mapper/session. | Refactor | ~2–3 days | ✅ **Done (3 of 4)** — `markdown-view` 1270→535, `settings` 995→865, `lsp-client` 1016→856. `monaco.ts` (flagged optional/cohesive) left as-is. |
| **P2** | **Adopt Memento** in `DockState` — undo/redo + layout persistence; consumes `undoStackSize`. | Feature/pattern | ~½ day | ✅ **Done** — undo/redo **and** per-blueprint layout persistence; consumes `undoStackSize`. |
| **P3** | Split the 5+-type grab-bag files (`ai-types.ts`, `settings-registry.ts`); adopt "one primary type per file" as a soft convention for new code. | Refactor | ~½ day | ✅ **Done** — `ai-types` → 6 `api/ai/*` modules + barrel; `settings-registry` → `settings-schema.ts` + data. |
| **P3** | **DRY clusters 3–5** — `CommandRouter<T>` base; merge ribbon button/small-button; merge text/password fields. | Refactor | ~1 day | ⛔ **Declined by design** — see outcomes. Kept `text/password` and `ribbon button/small` as separate components; kept the 5 command services standalone. The one real finding (text/password commit-event inconsistency) was **fixed without merging**. |
| **P3** | Doc hygiene — fix agents.md Angular **20 → 22** drift; repair orphaned TSDoc (`documents.ts:457` + malformed closers); split `SourceControlProvider` into read/mutate/remote before backend #2. | Docs/design | ~½ day | ✅ **Done (docs); split deferred** — agents.md 20→22 + all orphaned/malformed TSDoc fixed. The `SourceControlProvider` read/mutate/remote split is deferred to when backend #2 lands. |

**P0–P1 were completed before the current feature work, as prescribed.** They hardened the architecture
against regression and removed the leftovers that would otherwise get copied into new code.

<a id="remediation-outcomes-2026-07-04"></a>
### Remediation outcomes (2026-07-04)

**Shipped (P0–P3a, P3c):** boundary lint rule + the two cross-feature promotions (P0); dead-code deletion and
DRY clusters 1–2 (P1); the three god-file decompositions and the Memento (undo/redo **+** layout persistence)
(P2); the `ai-types` and `settings-registry` grab-bag splits (P3a); and the doc hygiene (P3c). Each landed
behind the full green gate (prettier / eslint / tsc / `ng build` / co-located specs) and the knowledge graph
was resynced after every structural change.

**Deliberately declined — P3b (the DRY merges).** After review these were judged to trade real flexibility
for a small, low-value dedup, against the house preference for **keeping distinct units separate**:

- **Cluster 5 — text-field / password-field merge: declined.** They serve different purposes (masking,
  `autocomplete=off`, password-manager signalling); one-atom-per-type is more discoverable. The report itself
  rated this LOW–MED. *However*, the genuine finding underneath it — the two committed their value on
  **different DOM events** (`text-field` on `change`/blur, `password-field` on `input`/keystroke) — **was
  fixed**: `text-field` now commits on `input` too, so the siblings behave identically without being merged.
- **Cluster 4 — ribbon button / small-button merge: declined.** Same instinct: kept as two components to
  preserve room to add new button types or split functionality later. (Size is a variant axis, but the
  flexibility of separate components was preferred over the ~40-line dedup.)
- **Cluster 3 — command-bus base/primitive: declined.** The genuinely-shared scaffold is only ~10 trivial,
  stable lines per service (a `handler` signal + `register`/`unregister`); the bulk (the typed forwarders)
  stays per-service under the house style regardless, so each file barely shrinks. Sharing it would couple
  five otherwise-independent services to a common primitive for little gain. (Both a composition primitive
  and an `AbstractCommandService` inheritance base were weighed; the differing public API names and non-uniform
  `hasActive` make the base awkward, and inheritance is the tightest coupling — so neither was adopted.)

**Deferred:** `monaco.ts` (772 LOC) decomposition — flagged optional/cohesive; and the `SourceControlProvider`
read/mutate/remote split — to be done when the second git backend lands.

**Net effect on §6 (one-type-per-file):** the two worst grab-bags after `settings.ts` are resolved —
`ai-types.ts` (21→split) and `settings-registry.ts` (schema vocabulary hived into `settings-schema.ts`).

---

## 11 — Keeping the knowledge graph in sync

The `/understand` knowledge graph (`.understand-anything/knowledge-graph.json`) is now the machine-readable
map that backs this report. It must not drift as you refactor and add features. Concretely:

**1. It's already set up for cheap incremental updates.** Phase 7 wrote a `fingerprints.json` baseline and
preserved `scan-result.json`. A later `/understand` run after new commits re-analyses **only changed
files** (via `git diff` + structural fingerprints), not the whole tree — so re-syncing is fast.

**2. Re-run `/understand` at these moments:**
- After each remediation above that **moves or deletes files** (the P0 promotions and P1 deletions change
  nodes/edges — the graph's import edges and the 2 INV2 violation edges must update).
- After merging any feature addition or enhancement.
- Before generating the next quality report, so the metrics are current.

**3. Enable automatic updates (recommended).** Run `/understand --auto-update` once — it writes
`{"autoUpdate": true}` to `.understand-anything/config.json`. Then wire it to your existing green-gate or a
git hook so the graph refreshes on commit. (A `post-commit`/`pre-push` hook running the incremental
`/understand` keeps it continuous; the fingerprint baseline is what makes this cheap enough to run
routinely — do **not** let a commit land with a fresh hash but stale fingerprints, or the next run
escalates to a full rebuild.)

**4. Keep the _human_ source of truth in lockstep.** `docs/agents.md` is the narrative counterpart to the
graph and is authoritative for the invariants. When an architectural decision changes (e.g. after promoting
`MarkdownCommands`/`CommitDetail`, or adding the boundary lint rule), update agents.md in the same commit —
and fix the current **Angular 20 → 22** drift while you're there. The boundary lint rule (P0) is what keeps
the graph's INV2 edge count at zero going forward: enforcement prevents the drift that the graph would
otherwise merely _report_.

**5. Treat a graph delta as a review signal.** After a change, a quick re-mine of the graph (cross-feature
import edges, new god-files > 500 LOC, new orphan nodes) is a fast, objective regression check on the
score-preserving contract in §9 — it catches an imported dependency or an oversized new file before it
becomes debt.

---

### Appendix — key metrics (commit c99011e)

- **Graph:** 817 nodes (509 file, 219 class, 80 function, 7 config, 2 doc) · 1,650 edges (870 imports, 299
  contains, 278 exports, 123 related, 71 calls, 5 configures, 3 depends_on, 1 deploys) · 7 layers.
- **Invariants:** INV1 (no feature code in shared) — **0 violations**; INV2 (no cross-feature imports) —
  **2 violations**.
- **`any` in product code:** 1 (a comment). **`InjectionToken` count:** 1.
- **One-type-per-file:** 172/294 files single-type; 83 have ≥2 (11 have ≥5).
- **God-files (>700 LOC):** markdown-view 1270, lsp-client 1016, settings 995, markdown-editor 890,
  settings-registry 827, icon 783 (registry, ok), repository-data 782 (mostly dead), monaco 772.
- **Most depended-upon:** icon.ts (67), app-icon.ts (45), dock-panel.ts (22), dock-node.ts (21),
  bridge.ts (18), tabs.ts (18).
