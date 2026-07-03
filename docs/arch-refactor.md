# Architecture Refactor — Technology-first → Feature-first

> Decision log. Status: **agreed, not yet built.** Branch: `feature/arch-refactor`.
> This is the fourth attempt. The previous three failed by over-engineering and
> growing into a bigger mess. The guardrails in §8 exist to prevent that. Read them.

## 1. Goal

Reorganise `src/` so the application is **feature-first, technology-second**. Today the
code is organised technology-first (`src/angular`, `src/electron`, `src/shared`) with each
feature threaded through all three layers.

`src/` will contain **exactly two** subdirectories:

```
src/features/<feature>/{angular,electron,api}   ← the recipe: composes shared parts
src/shared/{angular,electron,api}               ← the kitchen: runtime + reusable parts
```

Two invariants must hold:

1. **No feature code lands in `shared`.** `shared` must not name or import any feature.
2. **Features are isolated like plugins.** Everything a feature needs lives under
   `src/features/<feature>/`. Removing that directory removes the feature; the only
   straggler permitted is **one line** in the feature list (§4) — by design, not by accident.

Analogy (the user's): `shared` is a kitchen stocked with utensils and ingredients;
features are recipes that consume them.

## 2. Features

`workspace` (the `directory` tab), `repository` (the `source-control` tab), `code-editor`
(`code`), `markdown-editor` (`markdown`), `terminal`, `agent`, `settings`, `welcome`.

`settings` and `welcome` are not "features" in the strict sense but are leaf consumers of
shared infra, so they are modelled as features for uniformity.

## 3. The dividing line — kitchen vs recipe

**`shared` (kitchen) holds reusable capability components + framework.** Notably:

| Shared building block                     | Today                                                                                                                                          | Consumers                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Dock container/panel system               | `components/dock/**`, `services/dock/**`                                                                                                       | workspace, repository                        |
| Terminal component (xterm host)           | `views/terminal-view`                                                                                                                          | terminal, workspace, repository, code-editor |
| Code editor component (Monaco host)       | `views/code-view`                                                                                                                              | code-editor, workspace, repository           |
| Markdown editor component (Milkdown host) | `views/markdown-view` + `milkdown/**`                                                                                                          | markdown-editor, workspace                   |
| Agent chat UI                             | `components/shared/agent-chat`                                                                                                                 | agent + all 4 docked-agent hosts             |
| Ribbon framework                          | `components/strips/ribbon-strip/*` (not `ribbons/`)                                                                                            | shell                                        |
| Title / status strips, status-bar         | `components/strips/{title,status}-strip`, `services/status-bar`                                                                                | shell                                        |
| Atoms                                     | `components/forms/**`, `components/shared/**`, `icons/`, `styles/`                                                                             | everywhere                                   |
| **Bespoke 2-pane splitter**               | duplicated in code/markdown/terminal views                                                                                                     | → componentise into `shared`                 |
| IPC transport                             | `preload.ts` (→ generic, §5)                                                                                                                   | everything                                   |
| Cross-cutting services                    | `Tabs`, `Theme`, `Display`, `Lifecycle`, `Tasks`, `Output`, `Editors`, `Documents`, `Monaco`, `Terminals`, `agent`/`ai-runtime`/`ai-auth` core | everywhere                                   |

**A feature (recipe) holds the assembly:** a view that _composes_ shared components, plus
its ribbon contribution (`ribbons/<x>-ribbon`), its `*-commands`, `*-status`, `*-panels`,
and per-host glue. Per investigation, feature-owned services include: `diffs` (repository),
the per-host docked-agent panel state (`code-agents`, `terminal-agents`, markdown agent
panel), `code-runner`, `markdown-reader/review`, the various `*-commands` and `*-status`.

The **bespoke 2-pane layout** (a fixed editor↔side-pane splitter, distinct from the dock) is
currently hand-rolled three times — `code-view`, `markdown-view`, `terminal-view`. It is
componentised once into `shared` (e.g. `<app-split-pane>`) and consumed by all three.

### 3.1 Shared capability components (single-element wrappers) — the load-bearing contract

The kitchen's capability components are **thin wrappers around exactly one engine each** — no
splitter, no side panels, no ribbon, no embedded agent:

| Wrapper                 | Wraps                                                                       | Backing plumbing (also `shared`)                                             |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `<app-terminal>`        | xterm (DOM terminal; node-pty is its electron-side backend over the bridge) | pty api contract + electron terminal-manager + `terminals`/`terminal-bridge` |
| `<app-text-editor>`     | Monaco                                                                      | monaco service                                                               |
| `<app-markdown-editor>` | Milkdown/ProseMirror                                                        | milkdown service                                                             |
| `<app-agent>`           | the agent chat UI                                                           | agent / ai-runtime / ai-auth / agent-sessions + ai bridge                    |

Because the **shared** wrapper depends on its plumbing, that plumbing is shared too: e.g.
"spawn-and-render-a-pty" is a shared capability, so the terminal _feature_ owns little-to-no
unique `electron`/`api` — it composes the shared capability.

**Feature views are leaves** that compose the shared panel layout with these wrappers; the
side panels are thin hosts that drop a wrapper into a layout slot:

```
terminal-view = layout{ main: <app-terminal>,       side: <app-agent> }
code-view     = layout{ main: <app-text-editor>,    sides: <app-terminal>, <app-agent> }
markdown-view = layout{ main: <app-markdown-editor>, sides: outline/review/reader, <app-agent> }
```

Today's `terminal-view`/`code-view`/`markdown-view` **conflate** the engine pane with the
splitter and the side panels. The migration **decomposes** them: the engine pane is extracted
into its shared wrapper; the splitter becomes the shared panel layout; what remains is the leaf
view's composition. This is the sanctioned "componentise", not a free-for-all rewrite.

**Ordering consequence (resolves the shared-first vs slice-first question):** since a leaf view
is a pure composition of shared wrappers + layout, the wrappers and layout must land in `shared`
first. Then each leaf view imports only `@shared` — no transitional back-edges. The apparent
"terminal pulls in the whole agent subsystem" was an artifact of the conflation; the wrapper
boundary removes it.

## 4. The four coupling seams (and how each is resolved)

These are the only places where "delete the folder" currently leaks. Each gets one fix.

1. **Three hardcoded `@switch` blocks** keyed on `TabType`
   (`content-host.html`, `ribbon-strip-container.html`, chrome-gating in `root.html`) and the
   `TabType` union itself.
   → **Feature registry.** A `FEATURE` Angular **multi-provider** `InjectionToken`. Each
   feature contributes a descriptor; the shell iterates the registry instead of switching.

   ```ts
   // shared/angular — the runtime seam
   interface FeatureDescriptor {
     readonly id: string; // also the tab type, e.g. 'terminal'
     readonly view: Type<unknown>; // mounted in content-host
     readonly ribbon?: Type<unknown>; // contextual ribbon, optional
     readonly chrome?: { ribbon: boolean; status: boolean }; // settings = full-bleed
     readonly providers?: Provider[]; // feature-scoped providers (incl. eager glue)
     register?(host: FeatureHost): void; // optional imperative wiring (dock panels, commands)
   }
   const FEATURE = new InjectionToken<FeatureDescriptor>('FEATURE');
   ```

   `content-host` renders the active tab's view via `ngComponentOutlet` looked up from the
   registry; the ribbon container and chrome gating do the same. `TabType` becomes a string
   id owned by the registry, not a closed union in `shared`.

2. **`DockPanelRegistry.seed()`** hardcodes built-in tool panels by importing them.
   → Built-in panels become **per-feature dock-panel contributions** registered through the
   feature's `register(host)` (workspace/repository declare their panels). `shared/dock`
   keeps the registry mechanism but seeds nothing feature-specific.

3. **`config.ts`** eagerly injects `AgentEditorCapabilities` + `AgentTerminalCapabilities`
   (feature glue forced global so the main-process agent can always find it).
   → These move into their owning features (code-editor, terminal). The feature descriptor's
   `providers` + an `ENVIRONMENT_INITIALIZER` (or `provideAppInitializer`) inside the feature
   forces them eager. No feature glue remains listed in the shared bootstrap.

4. **The IPC God-object** — `shared/ipc-channels.ts` (every feature's channels),
   `shared/studio-api.ts` (one fat interface), `electron/preload.ts` (one literal). All three
   sit in `shared` and **name every feature** — the worst rule-1 violation. → §5.

## 5. IPC — a generic messaging layer (the enabler, not optional)

For `preload` to live in `shared` without naming features, it must stop being a typed,
feature-aware literal and become a **dumb pub/sub transport**:

```ts
// shared/api — the only IPC contract in shared
interface Bridge {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (...args: unknown[]) => void): () => void; // returns unsubscribe
}
// exposed as window.bridge by shared/electron/preload.ts — imports zero feature code
```

Each feature then owns its own IPC slice:

- `features/<f>/api` — channel-name constants + the typed request/response types.
- `features/<f>/angular` — a typed client **service** that wraps `window.bridge`
  (replaces the per-domain slice of the old `window.studio`).
- `features/<f>/electron` — the handler/manager (already self-registers via `register()`).

**Security is preserved.** The renderer is still treated as hostile: every handler keeps its
existing argument validation, an `invoke` to an unregistered channel rejects, and `send`
(main→renderer) is driven by main. The generic transport changes _who names the channel_, not
the validation guarantees. This actually **reduces** coupling — the preload ends up importing
nothing feature-specific, which is exactly why it can live in `shared` cleanly.

Net effect: the fat `StudioApi` interface, the monolithic `IpcChannel` enum, and the giant
preload literal are **deleted**, their contents redistributed to features.

## 6. Path aliases (the keystone)

Today there are **no** path aliases; 110 renderer files reach `shared` via deep relative
paths (`../../../../../../shared/ai-types`). Moving files while keeping relative imports
rewrites hundreds of brittle paths and re-breaks them on the next move — the likely mess
multiplier in prior attempts.

Introduce TypeScript `paths`:

```jsonc
"@shared/*":   ["src/shared/*"],
"@features/*": ["src/features/*"],
```

Honoured by Angular's esbuild builder and `tsc`. The preload's esbuild step must be pointed
at the tsconfig (`--tsconfig`) so it resolves aliases too. Imports become stable and
location-independent (`@shared/angular/...`, `@features/terminal/...`), so subsequent moves
are cheap. Each `shared`/feature unit exposes a small barrel for its public surface.

## 7. Build / config changes (mechanical, enumerated)

- `tsconfig.json` / `tsconfig.app.json` — add `paths`; update `include` to
  `src/features/**` + `src/shared/**` (drop `src/angular`, `src/shared` old globs).
- `angular.json` — `index`, `browser` (main.ts), `styles` (`styles.scss`) move from
  `src/angular/...` to their new `shared/angular` home.
- Electron tsconfig — one config compiling `src/**/electron/**` + `src/**/api/**`,
  `rootDir: src`, `outDir: dist-electron`. Output mirrors source: `main.js` and `preload.js`
  land under `dist-electron/shared/electron/`.
- `package.json` — update `main` (→ `dist-electron/shared/electron/main.js`),
  `build:preload` entry + add `--tsconfig`, and the `__dirname`-relative `INDEX_HTML` /
  `preload.js` paths inside `main.ts` shift by directory depth.
- Feature-leaning SCSS partials (`_milkdown.scss`, `_change-margin.scss`, `_tree.scss`,
  `_views.scss`) move into their features; `shared` `styles.scss` imports only shared.

## 8. Guardrails (anti-over-engineering — non-negotiable)

- **Stock Angular DI only.** `@Service()` (= `providedIn: 'root'`) and `InjectionToken`
  multi-providers. **No custom DI container, no plugin framework, no event-bus abstraction**
  beyond the generic `Bridge`.
- **Explicit feature list, no auto-discovery.** One barrel (`src/features/index.ts`) exports
  the `FEATURES` provider array; bootstrap consumes it. No build-time glob, no filesystem
  magic. Deleting a feature = delete its folder + remove one line here.
- **Relocation, not rewrite.** The move is behaviour-preserving: relocate files, switch
  imports to aliases, and add the registry/bridge seams. **Do not** refactor internal logic,
  rename for taste, or "improve" components while moving them.
- **Do not sub-divide shared capability components.** `code-view`, `markdown-view`,
  `terminal-view`, the dock, `agent-chat` move as-is into `shared`. They are large; that is
  fine. They are the kitchen.
- **Green after every commit.** The app must build and run at every step (§9). If a step
  can't stay green, it's too big — split it.

## 9. Sequencing — vertical slice first, Terminal as pilot

Agreed approach: prove the entire pattern on **one feature end-to-end**, then roll out the
rest by the proven template. The app is runnable after every step.

**Step 1 — scaffolding (no feature moved yet):**

- Add path aliases (§6) and the build/config changes (§7), app still green on old layout.
- Create `src/shared/{angular,electron,api}` and move the **obviously-shared infra** the
  pilot depends on (atoms, the generic `Bridge`/preload, the `FEATURE` registry token +
  registry-driven `content-host`/ribbon/chrome, the `terminal-view` component, the
  componentised 2-pane splitter).
- Existing features keep working through the registry with one descriptor each (a thin
  shim) so nothing breaks while only their _location_ is still old.

**Step 2 — pilot: `terminal` (chosen).** Exercises all three layers at once:

- `api` — pty channel constants + typed contract.
- `electron` — `terminal-manager` handler.
- `angular` — terminal view host (consumes shared `terminal-view` + shared split-pane),
  `terminal-ribbon`, `terminal-commands`, `terminal-status`, registered via its descriptor.
- Result: `src/features/terminal/` is self-contained; deleting it removes the terminal tab
  cleanly; app builds and runs.

**Step 3…N — roll out remaining features**, one per commit, by the Terminal template.
Suggested order (simple → entangled): `settings`, `welcome`, `agent`, `markdown-editor`,
`code-editor`, `repository`, `workspace`. (`workspace`/`repository` last — they own the dock
panel contributions and the most cross-feature glue.)

**Done when:** `src/` contains only `features/` and `shared/`; `shared` names no feature;
each feature folder is independently deletable; the app builds and runs throughout.

## 10. Progress log (status)

> **▶ NEXT SESSION — start here (2026-07-03).** **§5 IPC carve COMPLETE** (all ~10 domains on
> `window.bridge` + `shared/api` slices; god trio deleted — `studio-api.ts`/`ipc-channels.ts` gone,
> preload exposes only `window.bridge` + `window.host`; probe = `window.bridge !== undefined`).
> **§7 ELECTRON RELOCATION COMPLETE too:** `main.ts`/`preload.ts` + the whole remaining cone
> (`ai/`, `lsp/`, `project-system/`, `workspace-context`, `workspace-manager`, `startup-preferences`,
> the electron `tsconfig.json`) moved into `src/shared/electron/` as a unit; **`src/electron/` is
> DELETED.** Key call: the build **output stayed at `dist-electron/electron/`** (only esbuild INPUT paths
> changed) so `__dirname`/`INDEX_HTML`/preload-sibling/`package.json main` are all untouched — zero
> runtime-path churn. main/preload needed no import edits (only `./` siblings + `@shared` aliases); the
> 14 cone files' relative `../shared/…` were converted to `@shared/…`. Verified by a full-app CDP boot
> smoke (app renders, `window.bridge`/`window.host` live, relocated ai + git handlers wire up).
> **`src/` is now `{ angular, features, shared }`.**
> **Recommended next: the renderer feature relocation — the last stretch to the §1 end state
> (`src/` = `features/` + `shared/` only).** `src/angular/` still holds the two unmigrated tab features
> (`repository`/source-control, then `workspace`/directory — do them in that order, they own the dock +
> the most cross-feature glue) plus the residual `src/angular/services` + `src/angular/components` that
> belong under `shared/angular` or a feature. Follow the proven feature recipe (§9 Step 3): gate-check
> the cone → move foreign kitchen deps to `shared` → sever cross-feature embeds → relocate to
> `features/<f>/{angular,electron,api}` → `<f>.feature.ts` + one `config.ts` line → delete its `@case`.
> When `src/angular/` empties, the refactor is done.
> **Reference:** `window.host` (chrome slice) is the static-data counterpart to `window.bridge`
> (preload-exposed, `shared/api/host.ts`, for pre-first-paint values). `ai-types.ts` deliberately stayed
> in `src/shared/` (30 importers); a later cosmetic move under `shared/api` is optional. Working state:
> **clean, all green (6 baseline fails; ~9 pre-existing prettier warnings, none introduced), fully pushed
> to `origin/feature/arch-refactor`.**

Branch `feature/arch-refactor`. **Green after every commit** = `ng build` + `eslint src` +
`prettier --check` pass and the test suite holds its baseline (**6 known pre-existing fails**,
none introduced by this refactor — they predate it, sit in code/specs the refactor does not
touch on its boundaries, and are all test-side or pre-existing component drift). Don't chase
them as regressions; the exact cause of each (verified by running the suite):

- **`solution-model.spec` › `rootNode_whileContentsLoad_isCollapsedNonExpandableWithSpinner_thenExpands`**
  — `AssertionError: expected ['MySolution','Group','A','B'] to deeply equal ['MySolution']`. The
  test expects the root to start collapsed (spinner, children not yet visible) during an async load
  phase, but the model populates children synchronously, so all nodes are already visible. Test ↔
  model timing-contract mismatch.
- **`solution-panel.spec` › `render_whenModelPresent_showsARowPerVisibleNode`, `onRowClick_anExpandableRow_togglesIt`, `onRowClick_aFileRow_opensIt`** (×3)
  — `TypeError: ctx_r1.query is not a function`. The panel template calls a `query(...)` the
  component no longer exposes (component/template drift); all three fail on the same missing method.
- **`markdown-view.spec` › `create_whenConstructed_returnsComponent`** — the assertion itself passes
  (component constructs), but fixture teardown runs `ngOnDestroy`, which reads the **required**
  `documentId` input the spec never sets → `NG0950: Input "documentId" is required but no value is
available yet`, so cleanup throws and the test is marked failed. The original (pre-split)
  `markdown-view` failed identically — its `ngOnDestroy` also read `documentId()`. Trivially fixable
  by `setInput('documentId', …)` in the spec.
- **`status-strip-lsp-menu.spec` › `render_labelsTheCategoryAndReflectsTheStartingState`** —
  `AssertionError: expected "…lsp-status-menu__trigger" to contain "lsp-status-menu__trigger--starting"`.
  The test expects the trigger to carry the `--starting` modifier, but the rendered state has no
  language server in the "starting" phase, so the class is absent. Test fixture/state mismatch.

Commit refs below are on this branch.

### Done

- **Keystone — path aliases** (§6): `@shared/*`→`./src/shared/*`, `@features/*`→`./src/features/*`
  in `tsconfig.json` `paths`; proven across ng build + preload esbuild + main esbuild (the
  electron **main is now esbuild-bundled**, was tsc-emit, so aliases resolve at runtime).
- **Registry seam** (§4 seam 1): `@shared/angular/services/feature-registry` — `FeatureRegistry`
  (signal map keyed by tab-type string), `FeatureDescriptor` (view + optional ribbon + chrome),
  `provideFeature()`. `content-host` + `ribbon-strip-container` + **root chrome gating** are now
  fully registry-driven — the shell names no feature type anywhere (seam 1 **closed**).
- **Kitchen relocated to `@shared`** (bottom-up, all mechanical): icon system, tabs/studio/
  status-bar, settings core (`settings` + `settings-registry`), workspace, agent core (agent/
  agent-engine/ai-runtime/ai-auth/agent-sessions), `<app-agent>` (agent-chat), form atoms (12),
  ribbon framework controls (10), Display/Security/lsp-settings.
- **Features stood up** (registry-driven, each independently deletable = folder + one `config.ts`
  line): **`terminal`**, **`agent`**, **`settings`**, **`markdown`**, **`code`** under
  `src/features/<f>/angular`.
- **Shared capability wrappers — the §3.1 contract, each wraps EXACTLY ONE engine:**
  - **`<app-terminal>`** = xterm. (`shared/angular/components/terminal`.)
  - **`<app-text-editor>`** = Monaco. (`shared/angular/components/text-editor`.) Commits:
    `9ea1fc0` move Monaco+Editors→shared (engine backing) · `2ddf692` build the wrapper ·
    `7611fa7` rewire `code-view` into a leaf composing it.
  - **`<app-markdown-editor>`** = Milkdown/Crepe. (`shared/angular/components/markdown-editor`.)
    Commits: `c7c0e9d` move Milkdown plugins (9) + media-source + service→shared · `5f9615f`
    build the wrapper · `0585715` rewire `markdown-view` into a leaf composing it.

### The wrapper→leaf pattern (proven, reuse for the rest)

Wrapper owns ONLY the engine: instance create/dispose, live theme/settings, content I/O, and
change/selection reporting — NO ribbon/panels/splitter/document-model/save/LSP. It exposes an
**imperative API** (`getEditor()`/`getModel()` for Monaco; `getCrepe()`/`getEditorView()`/
`getScrollContainer()` for Milkdown — richer because outline/review/reader need the live view +
DOM) and outputs **`ready`** + `contentChange` (+ Monaco `cursorChange`/`eolChange`; Milkdown
`selectionChange`/`saveRequested`). The **leaf** (feature view) binds inputs, listens to outputs,
and does ALL feature glue on the `ready` emit — `code-view` attaches change-margins + registers
with `Editors` + syncs LSP; `markdown-view` attaches the outline scroll-spy + review/read sessions

- ribbon command handler. Content round-trips via `[content]` in / `(contentChange)` out, with an
  internal `ignoreNextChange` guard preventing the echo. No feature→feature or feature→shell
  back-edges introduced. Monaco's `Editors` registry kept shared so LSP/diagnostics stay
  feature→shared, not feature→feature.

Milkdown diverges from Monaco (don't assume a clean mirror): Crepe has **no `setMarkdown`** (external
content = recreate the editor, or a parser→`replaceWith` transaction), async out-of-zone create, a
**spurious first `markdownUpdated`** (swallowed via `hasReceivedFirstUpdate`), the custom-node
(HTML-image/mermaid) editors travel with the wrapper, and it has **no status outputs**.

### Validation

Unit specs can't boot Monaco or Crepe (jsdom lacks the layout APIs), so each wrapper has a thin
null-safe spec and is **smoke-tested in the real Electron app via CDP**. Both passed end-to-end:
Monaco (renders, typing→dirty tab, status Ln/Col/EOL, change-margin gutter); Milkdown (renders,
`# ` input rule→`<h1>`, typing→`contentChange`→dirty doc, Outline panel populates via
`getEditorView()`, tool-panel + splitter dock beside the pane).

How to re-run a CDP smoke test (macOS, no playwright/puppeteer in repo):

1. `npm run build:electron` then `ng serve --host 127.0.0.1 --port 4200`.
2. `ELECTRON_START_URL=http://127.0.0.1:4200 nohup ./node_modules/.bin/electron . --remote-debugging-port=9222 >log 2>&1 & disown`
   — launch the electron **binary directly + `disown`**; `npx`-wrapped nohup dies when the shell
   call returns. Rebuild node-pty for the electron version first if the terminal is involved
   (`npm run rebuild`).
3. Drive over CDP with Node 24's global `WebSocket`/`fetch` (no deps). `window.ng.getComponent(el)`
   reads component instances + private fields in the dev (unminified) build. Note Milkdown's
   `markdownUpdated` is **debounced ~600ms** — wait before asserting dirty state.

### Markdown feature (done) + the view/well split + document-panel seam

**`markdown` stood up** at `src/features/markdown/angular` (view, ribbon+insert-modals,
`markdown-commands`/`-panels`/`-reader`/`-review`, plus the two new pieces below). Registered by one
`provideMarkdownFeature()` line in `config.ts`; `@case`s deleted from `content-host` +
`ribbon-strip-container`. Prerequisites promoted to `@shared` first: `documents` + its filesystem
cone (`file-system`/`-watch`/`-conflicts`), and the `modal` atom (used by insert-modals, source-control,
welcome). Commits: `af65614` (documents→shared) · `6dd8d36` (inner core) · `3fb3cd8` (well panel +
registry seam) · `df6e671` (relocate + register).

**A "view" is a tab-only leaf; the document well is a DIFFERENT leaf.** Discovered: the workspace
document well (`document-panel`) was reusing the full feature _views_ (`<app-code-view>`/
`<app-markdown-view>`) to show open documents — an inbound feature→feature edge the outbound-import
gate-check missed. Corrected model (user's): a **view** is the holistic tab surface (tab + ribbon +
editor + optional panels + status, the shell supplying ribbon/status/tab); the **well** must NOT
import a view. Instead:

- **Shared inner core** (`markdown-document`, feature-owned): wraps the shared `<app-markdown-editor>`
  - owns the document binding (seed from `Documents`, write edits back, save, language/lifecycle,
    active-doc). The content round-trip is gone from the shell — the core self-owns it via `Documents`.
- **Tab leaf** (`markdown-view`): core + tool panels + ribbon command handler + sessions. Its id input
  is **`tabId`** (the `FeatureViewInputs` contract the registry mounts by), not `documentId`.
- **Well leaf** (`markdown-document-panel`, lean): core + a compact toolstrip (name/dirty/save) + a
  status strip (word count). No ribbon, no tool panels; editable like a tab. Both leaves share the core.
- **Registry `documentPanel` seam** (§4 seam-1 shape, extended): `FeatureDescriptor.documentPanel?` +
  `FeatureRegistry.documentPanelFor(type)`; `document-panel` mounts it by document type via
  `ngComponentOutlet`, importing only `@shared`. Falls back to the tab view for unmigrated types.

**Bridges — the one sanctioned cross-feature coupling.** `AgentEditorCapabilities` (agent↔editor,
eager in `config.ts`, per §4 seam-3 slated to leave `src/angular`) dispatches through BOTH
`CodeCommands` and `MarkdownCommands` (read/replace the active document). Per the user's rule: a
**bridge** is the ONE place where a capability used across features may couple to multiple features'
command seams; **neither editor feature owns the other's bridge commands**. So the bridge importing
`@features/markdown/markdown-commands` is by design (not a rule-1 violation). It stays app-level glue
for now and ultimately lands outside both editor features (resolve with the code phase).

### Code feature — cross-cutting infra promoted to @shared (DONE); stand-up (DONE)

The `code` gate-check (using the sibling-safe + inbound-embed lens) found the cone far more
entangled than markdown, almost entirely with the **workspace (directory)** feature, via editor
command/terminal registries **and** a `Tasks`/build cluster. **Decision taken (option 1):** the
cross-cutting infra becomes shared kitchen (the `Editors`-registry precedent), with light generic
renames on the feature-named registries. That promotion is **complete** — five commits, baseline
green throughout (117 fail / 840 pass):

- `cb796fc` — `lsp` + `diagnostics` → `@shared/angular/services/{lsp,diagnostics}` (mutually dependent
  Monaco infra; consumed by workspace + shell + code).
- `be44a44` — `code-terminals` → `@shared/…/editor-terminals`, class `CodeTerminals`→`EditorTerminals`
  (`TerminalLayout` kept). Editor-docked-terminal registry; consumed by code, workspace, Tasks.
- `570c6cf` — `code-commands` → `@shared/…/editor-commands`, `CodeCommands`→`EditorCommands`,
  `CodeCommandHandler`→`EditorCommandHandler`. Active-editor command router; consumed by code,
  directory-ribbon (workspace), and the agent bridge.
- `d9c8a1d` — `Output` + the whole `Tasks`/build cluster (`tasks`, `task`, `build-runner`, `builds`,
  `problem-matcher`, `providers/run-file-task-provider`) → `@shared`. Consumed by code-runner (code)
  and directory-ribbon/-view (workspace); generic names, no rename.

**Result — the code cone is now cleanly isolatable.** `code-view` imports only `@shared` (text-editor,
editors, editor-commands, editor-terminals, lsp, documents, theme, active-workspace) + code-owned
siblings; `code-agents` / `code-status` / `code-runner` / `change-margin` (all three files) have **no
external consumers**. The deferred workspace/bridge couplings are resolved — they route through the
shared registries. `content-host.spec` already stubs the `code` type.

**DONE — `@features/code` stood up, mirroring the markdown 3-commit template** (4 commits, baseline
green throughout = 6 fail / 953 pass):

1. `f451905` — **`<app-code-document>` inner core** (`CodeDocumentEditor`) over `<app-text-editor>`:
   resolves the backing document, seeds content/language, records edits back via `Documents`, tracks
   the active doc, exposes `document()` + `getPane()`. Its `:host` fills BOTH slot shapes (`100%` sizing
   **and** `flex`) — code-view's slot is a definite-height block, not markdown's flex container, so
   `flex:1` alone would zero-collapse. `0801da8` — rewire `code-view` as a tab-only leaf composing it.
2. `92e21a4` — **lean `<app-code-document-panel>`** well leaf (toolstrip name/dirty/save; inline
   status strip Ln/Col + language + EOL). Status renders inline, NOT via `CodeStatus` (that publishes
   to the shell status bar owned by the enclosing workspace tab). Built but not registered here.
3. `a15e474` — **relocate** the whole cone → `src/features/code/angular` (code-view + its two
   subpanels, code-document, code-document-panel, code-ribbon, and services code-agents/code-status/
   code-runner/change-margin); intra-cone cross-dir imports → `@features/code/angular` alias; inline
   `ribbon-row.scss` → `code-ribbon.scss`; write `code.feature.ts`
   (`{ type:'code', view, ribbon, documentPanel }`) + `provideCodeFeature()`; one `config.ts` line;
   delete the `code` `@case` from `content-host` + `ribbon-strip-container` and the now-dead
   `@else <app-code-view>` fallback + import from `document-panel`.
   - The code **electron footprint** (`src/electron/code-runner.ts`, LSP server registry) stays in
     `src/electron` for the §5 electron carve; `change-margin` is code-feature-owned (not shared).
   - **CDP-smoke passed** (§10 Validation): the registry mounts `code-view → code-document →
text-editor → .monaco-editor` + `code-ribbon`; no zero-height (1280×619 through the chain);
     edit → `contentChange` → `Documents` dirty → tab dirty dot; status strip
     `New Document · Ln 2 · Col 1 · LF · UTF-8` (cursor/EOL re-emit through the core);
     `FeatureRegistry.documentPanelFor('code')` → `CodeDocumentPanel` (well leaf wired, fallback dead).

### Then (in roughly this order)

- **`<app-diff-editor>` (DONE)** — `af19db4` add the shared pane + `Monaco.getDiffEditorOptions()`;
  `0a03961` rewire `diff-view` as a leaf composing it. The §3.1 decomposition applied to the diff
  surface: the source-control `diff-view` conflated the Monaco `createDiffEditor` engine (two read-only
  models, theme, dispose) with source-control chrome (file header, git change-status badge, empty
  state). Extracted the engine into `@shared/angular/components/diff-editor` (`<app-diff-editor>`, the
  diff sibling of `<app-text-editor>` — read-only two-model vs single editable); `diff-view` keeps the
  chrome and forwards `original`/`modified`/`language`/`inline`. Construction options deduped into
  `Monaco.getDiffEditorOptions()` (byte-identical to the old inline literal; `renderSideBySide` stays a
  per-view flag at the call site). The leaf shrank 236→60 lines. Green: build + eslint + prettier +
  suite baseline (6 fail / 956 pass, +3 new diff-editor specs). **Live CDP diff-render was NOT run**
  — the esbuild dev server doesn't serve app source modules for import, and git IPC returned empty in
  the ad-hoc launch (real repo, commits=0), so staging a live diff was disproportionate and would test
  the git bridge, not this change; validated instead by the verbatim-copy + byte-identical-options +
  build/tests, with Monaco boot already proven in the code-feature smoke.
- **Generic `Bridge` + `shared/electron` carve** (§5) — **COMPLETE. All 10 IPC domains carved (terminal,
  file/dialog, workspace/project, security, run/tasks, lsp, shell, chrome cluster, source-control/git,
  ai). The god trio is DELETED** (`studio-api.ts` + `ipc-channels.ts` removed; preload exposes only
  `window.bridge` + `window.host`; `global.d.ts` drops `studio?`). Every `window.studio.<domain>` now
  rides `window.bridge` + a `shared/api` channel slice. The enabler and the pattern, proven end-to-end
  on the terminal slice:
  - `feat(shared) window.bridge` — the generic pub/sub transport: `Bridge` interface in
    `src/shared/api/bridge.ts` (`invoke`/`send`/`on` over raw channel names), exposed by the preload as
    `window.bridge` alongside `window.studio`, naming no feature (strips the Electron event so listeners
    get only the payload). Additive.
  - `refactor(terminal)` ×2 — the first real slice, proving renderer + api + electron in one capability.
    Because the shared `<app-terminal>` needs the pty, its backing is **shared, not feature-owned**
    (§3.1): pty channel contract → `src/shared/api/terminal-channels.ts` (`TerminalChannel` enum +
    `TerminalCreateOptions/Result`); `TerminalBridge` (shared client) drives them over `window.bridge`;
    `terminal-manager` → `src/shared/electron/` naming the enum; the terminal slice **deleted wholesale**
    from the god trio (`IpcChannel` 7 members, `StudioApi.TerminalApi`+types+field, preload literal).
  - **Build wiring learned (reuse for the rest):** the renderer tsconfig (`tsconfig.app.json`, which
    globs `src/shared/**`) must **exclude** `src/shared/electron/**` + `src/features/**/electron/**`
    (node/electron code); the electron tsconfig already compiles `src/shared` via `../shared/**` and
    excludes only `../shared/angular`; the **root tsconfig must `reference` the electron tsconfig** or
    eslint's `projectService` can't place relocated electron files (parsing error). esbuild
    `build:main`/`build:preload` resolve `@shared/...` via tsconfig paths, so main-side aliases work.
  - **CDP smoke passed:** terminal tab spawns a pty over `window.bridge`, input writes reach it, output
    round-trips to xterm (`echo` result rendered); `window.studio.terminal` is gone.
  - `refactor(file)` — the **file/dialog** slice (shared plumbing: documents' file cone is shared
    kitchen). `src/shared/api/file-channels.ts` (`FileChannel` enum: `file:read/write/watch/unwatch/
changed` + `dialog:open-file/pick-image/save-file/confirm-save`, plus `FileInfo`/`FileWriteResult`/
    `SaveDialogChoice`); `FileSystem` + `FileWatch` clients on `window.bridge` (`FileSystem` gained
    `pickImage` so `markdown-image-modal` stops touching `window.studio`); `file-manager` +
    `file-watcher` → `src/shared/electron/`. `FileInfo` is the first **cross-slice type** — `OpenSelection`
    (workspace) and several renderer services import it from `file-channels`. Deleted from the god trio:
    9 `IpcChannel` members, `FileApi` + 3 types + field, preload literal. **CDP smoke:** `file:read`
    returns `package.json`, `file:write`+read-back round-trips over `window.bridge`; `window.studio.file` gone.
  - `refactor(workspace)` — the **workspace/project** slice. `workspace-channels.ts` (`WorkspaceChannel`
    9 members + `DirectoryEntry`/`DirectoryEntryType`/`DirectoryListing`/`FileOperationResult`/
    `OpenSelection`) and `project-channels.ts` (`ProjectChannel` model/items; payloads stay in the neutral
    `project-system`). `Workspace` + `SolutionModel` clients on `window.bridge`. **Split-if-too-big call:**
    `workspace-manager` **stays in `src/electron`** (repointed to the new enums) because its cone —
    `workspace-context` + `project-system/` — is shared with `lsp-manager` and `main`; that shared-electron-
    infra move rides the §7 electron-tree relocation, not this slice. create/rename/delete have no renderer
    caller, so the client wraps only the 5 used ops (handlers stay). Deleted from the god trio: 11
    `IpcChannel` members, `WorkspaceApi` + `ProjectApi` + 5 types + 2 fields, preload literals. Repointed
    every moved-type consumer (directory-view, workspaces, file-opener, build-runner, lsp-client + specs)
    and rewrote 4 `WorkspaceApi`/`ProjectApi` fakes as `Bridge` mocks. **CDP smoke:** workspace/project
    handlers registered (confinement returns `null` over `window.bridge`), boots clean, studio.workspace/
    project gone. **Regression caught by the suite:** `build-runner.spec` injects the real (now bridge-backed)
    `Workspace` — its `window.studio.workspace` mock had to become a `window.bridge` mock.
  - **`Bridge`-mock spec recipe (reuse for the rest):** replace `window.studio.<domain>` fakes with a
    `window.bridge` object routing by channel (`invoke<T>(channel, ...args)` → `switch`/`if`), `send`/`on`
    stubs; compare `channel === (SomeChannel.X as string)` — the bare enum-vs-string comparison trips
    `@typescript-eslint/no-unsafe-enum-comparison`, the `as string` cast satisfies it. Set
    `(window as unknown as { bridge: Bridge }).bridge = …` in `beforeEach`, `delete` it in `afterEach`.
  - `refactor(security)` — the **security** slice (CSP image-source policy; app-wide shared plumbing).
    `src/shared/api/security-channels.ts` (`SecurityChannel` get/set-image-policy + the `ImageSourcePolicy`
    payload) — **consolidated the old dedicated `security-types.ts` into the api-slice home and deleted
    it**, dropping the `SecurityApi` interface (the bridge client is the typed wrapper). `Security` client
    - spec on `window.bridge`; settings' `ImageSourcePolicy` binding repointed. `security-manager` **and its
      1-file cone `media-protocol`** (the self-contained `studio-media://` scheme, used by `main` + the
      manager) → `src/shared/electron/` — **opposite call to workspace's cone:** 1 tiny self-contained file
      is cheap to move now, so it moved, rather than deferring to §7. Deleted from the god trio: 2
      `IpcChannel` members, `SecurityApi` + field, preload literal, `security-types.ts`. **CDP smoke:**
      `security:get/set-image-policy` round-trips over `window.bridge` (https→all→restore), boots clean with
      the relocated media scheme, `window.studio.security` gone.
  - `refactor(tasks)` — the **run + task-execution** slice (one cohesive cluster; both clients live under
    `shared/angular/services/tasks/`). **Two api files in one slice:** `task-channels.ts` (`TaskChannel`
    run/cancel/output/exit + `TaskRunRequest`/`TaskRunResult`/`TaskOutputStream`, consolidating and
    deleting `task-types.ts`) and `run-channels.ts` (`RunChannel` write-temp-file + `TempFileResult`,
    moved out of studio-api). `BuildRunner` (tasks: run/cancel over `invoke`, output/exit over
    `bridge.on`) and `RunFileTaskProvider` (run: write-temp-file over `invoke`) on `window.bridge`; their
    spec fakes folded into one `FakeTaskBridge` / bridge mock. `code-runner` + `task-runner` (both
    self-contained — only built-ins) → `src/shared/electron/`. Deleted from the god trio: 5 `IpcChannel`
    members, `RunApi` + `TaskApi` + `TempFileResult` + both fields, 2 preload literals, `task-types.ts`.
    **CDP smoke:** `tasks:run` spawns a child and streams output + exit 0 over `window.bridge`;
    `run:write-temp-file` writes a temp file; `window.studio.run`/`tasks` gone.
  - `refactor(lsp)` — the **language-server** slice, the largest. `git mv src/shared/lsp-types.ts →
src/shared/api/lsp-channels.ts` (history preserved), added the `LspChannel` enum (8: start/stop/
    notify/request/notification/server-exit/get/set-settings), dropped `LspApi`; repointed ~11
    `lsp-types` importers. **All three renderer clients** rewired: `LspSettings` (get/set via `invoke`),
    `LspFeatures` (request via `invoke`), `LspClient` (start/stop/get-settings via `invoke`, **notify via
    `bridge.send`** — the first send-based domain client, onNotification/onExit via `bridge.on`). All
    three specs' fakes rewritten (`FakeLsp implements Bridge`). `lsp-manager` + electron `lsp-settings`
    **repointed in place** (kept in `src/electron/lsp/`) — `lsp-manager` depends on the deferred
    `workspace-context`, so its cone rides §7. Deleted from the god trio: 8 `IpcChannel` members,
    `LspApi` + field, preload literal, `lsp-types.ts` (renamed into the slice). **CDP smoke:**
    `lsp:get/set-settings` round-trips over `window.bridge` (toggle java → reflected → restored); the
    richer start/notify/onNotification/onExit paths are exercised by the passing `lsp-client.spec`
    through the `FakeLsp` bridge; `window.studio.lsp` gone.
  - `refactor(shell)` — the **shell** slice, and the **first inline-handler case** (the pattern the
    chrome cluster reuses). `shell-channels.ts` (`ShellChannel` open-path/open-external; no payload
    types — just string args) + a new shared `Shell` service wrapping them over `window.bridge`. The two
    direct consumers repointed at it: `agent-chat` (link clicks) now injects `Shell` instead of reaching
    into `window.studio.shell`, and **`openPath` moved out of the `Studio` wrapper into `Shell`**
    (`terminal-view`, its only caller, repointed) — leaving `Studio` as purely the chrome-cluster wrapper
    (platform + windowControls) for the next slice. **The handler stays inline in `main.ts`:** it is woven
    into the nav/window security guards (`openExternalUrl` is shared with the window-open handlers), so it
    is not a standalone manager and rides the §7 `main.ts` move; only the two channel refs switch to
    `ShellChannel`. Deleted from the god trio: 2 `IpcChannel` members, `ShellApi` + field, preload literal.
    **CDP smoke:** `shell:open-path` returns `Invalid path` for an empty path and `shell:open-external`
    no-ops a rejected scheme, both over `window.bridge` (nothing launched); `window.studio.shell` gone.
  - `refactor(chrome)` ×2 — the **chrome cluster** (`windowControls` + `app` + `display`), split by the
    async/sync seam. **Part 1 (pure channels):** `window-channels.ts` (`WindowChannel` minimize/toggle/
    close/set-movable, all `send`) + `app-channels.ts` (`AppChannel` request-close/confirm-close). `Studio`
    drives window controls over `bridge.send`; `Lifecycle` drives the close round-trip (`bridge.on`
    request-close, `bridge.send` confirm-close), its `AppApi` fake → bridge mock. **Part 2 (static/sync
    tail — the new bit):** the display startup snapshot + `platform` are read _synchronously before first
    paint_, so they can't cross the async bridge → introduced **`window.host`**, a small static object the
    preload exposes alongside `window.bridge` (typed `HostEnv` in `shared/api/host.ts`, which also now owns
    `GpuRenderingInfo`). The `Display` service reads `window.host.display` for its snapshot and drives
    set-hw-accel (invoke) + relaunch (send) over the bridge; `Studio.platform` reads `window.host`;
    pre-bootstrap `main.ts` reads `window.host.display` for the first-paint policy. Dropped the unused
    `versions` surface. **Handlers stay inline in `main.ts`** (chrome; ride §7) — only channel refs switch
    (`main.ts` no longer imports `IpcChannel` at all). Deleted from the god trio: 9 `IpcChannel` members
    (4 window + 5 app), `WindowControlsApi`/`AppApi`/`DisplayApi`/`RuntimeVersions`/`GpuRenderingInfo` +
    the display/windowControls/app/platform/versions fields, the two preload literals + the static studio
    surface. **`window.studio` now holds only `{ sourceControl, ai }`.** **CDP smoke:**
    `window:toggle-maximize` visibly resizes the window (1280×800↔1920×1050) and `app:set-hardware-
acceleration` round-trips over `window.bridge`; `window.host.platform='darwin'` + GPU snapshot present;
    `window.studio` keys are exactly `['sourceControl','ai']`; boots clean.
  - **`window.host` (design note).** The sanctioned static-data counterpart to `window.bridge`: for host
    facts the renderer needs synchronously at startup, before any async round-trip (platform, display/GPU
    startup snapshot). Preload builds it from the one `sendSync` channel (`app:get-display-startup`) that
    is not reached over the bridge. When more sync-startup needs appear, they belong here, not on a channel.
  - `refactor(source-control)` — the **git** slice, and the **largest** (18 channels, 5 renderer
    consumers, a relocated manager). `source-control-channels.ts` (`SourceControlChannel` enum + the
    `RepositoryInfo`/`GitRunResult` types relocated from studio-api + a renderer-facing
    `SourceControlClient` interface). A shared `SourceControl` @Service exposes
    `client: SourceControlClient | undefined` — the 18 ops built over `bridge.invoke`, or undefined
    outside Electron — **so every `this.api?.method(...)` call site stayed byte-identical; only the source
    of `api` changed.** The `read`/`mutate` closure abstraction in `git-provider` kept working via a
    one-word type rename (`SourceControlApi`→`SourceControlClient`). **`git-provider` is `new`'d, not
    DI:** it takes the client through its constructor, and its factory (`SourceControlProviders`) injects
    `SourceControl` and passes `.client` in — the pattern for a non-DI consumer of a bridge client. The
    other four (`repository-opener`, `workspace-git`, `directory-view`, `source-control-view`) inject
    `SourceControl` and read `.client`; `repository`/`repositories` just repoint the `RepositoryInfo`
    type import. `GitManager` is self-contained (built-ins + electron + shared types) → **git-moved to
    `shared/electron`**, channel refs + types repointed, `main.ts` imports it via `@shared/electron`.
    Deleted from the god trio: 18 `IpcChannel` members, `SourceControlApi` + `RepositoryInfo` +
    `GitRunResult` + the `sourceControl` field, the preload literal + its type imports; studio-api's
    orphaned `StudioApi` doc comment reunited with the interface. **`window.studio` now holds only
    `{ ai }`.** **CDP smoke:** `source-control:{resolve,status,close}-repository` round-trips over
    `window.bridge` against this repo (resolves `onixlabs-studio`, `status` succeeds, closes cleanly);
    `window.studio` keys are exactly `['ai']`.
  - `refactor(ai)` — the **ai** slice, the **last domain** and the **richest surface**: `invoke`
    (auth/config/run-control) + main→renderer `on` streams (events + in-app-capability requests) +
    renderer→main `send` (replies). `ai-channels.ts` (`AiChannel` enum + a renderer-facing `AiClient`
    interface). A shared `Ai` @Service exposes `client: AiClient | undefined` built over `window.bridge`
    — `invoke`/`on`/`send` mapped per channel (the `on` wrappers cast `args[0]` to the payload; the
    generic `bridge.on` already strips the event and returns the unsubscribe) — so `ai-auth` + `ai-runtime`
    keep every `this.api?.method(...)` call site. **`ai-types.ts` stayed put** as the shared payload module
    (30 importers across both processes; only its `AiApi` interface was dropped, replaced by `AiClient`) —
    physically relocating it is §6/§7, not the transport carve. The two specs' `AiApi` fakes became bridge
    mocks — notably the `on`-stream listeners are captured through the mock's `on` so the tests still drive
    events/capability-requests. `ai-manager`/`ai-auth-manager`/`renderer-bridge` repoint their 11 channel
    refs to `AiChannel` **in place** (the `ai/` cone is large — its physical move rides §7, as lsp did).
    `output-panel` + `monaco-diagnostics-provider` switch their `am-I-in-Electron?` probe from
    `window.studio` to `window.bridge`. **THE GOD TRIO IS DELETED:** `studio-api.ts` + `ipc-channels.ts`
    removed; preload drops the whole `window.studio` surface; `global.d.ts` drops `studio?`. **CDP smoke:**
    `window.studio === undefined`; `ai:auth-status` (`local-login`) + `ai:list-providers`
    (`[claude,vercel,ollama]`) invoke over `window.bridge`, `ai:event` subscription returns an unsubscribe;
    `window.bridge` + `window.host` present, boots clean.
  - `refactor(electron)` — **§7 physical relocation DONE.** The whole remaining `src/electron/` tree
    moved into `src/shared/electron/` as a unit (`main.ts`, `preload.ts`, `workspace-context`,
    `workspace-manager`, `startup-preferences`, and the `ai/`, `lsp/`, `project-system/` dirs + the
    electron `tsconfig.json`); **`src/electron/` deleted.** **Key decision (diverges from the earlier
    plan wording): keep the build OUTPUT at `dist-electron/electron/`** — change only the esbuild INPUT
    paths. Because `__dirname` at runtime is the _output_ dir (unchanged), `INDEX_HTML` (`__dirname/../../
dist/…`), the `preload.js` sibling, and `package.json main` all stay valid — **zero runtime-path
    churn, no electron-builder change**. Mechanics: `main.ts`/`preload.ts` needed no import edits (only
    `./` siblings, which move as a unit, + `@shared` aliases); the 14 cone files using relative
    `../shared/…` were converted to `@shared/…` (depth-change breakage). The moved electron `tsconfig`
    was repointed (`extends ../../../tsconfig.json`, `include ../**/*.ts`, `exclude ../angular/**`) and
    the root tsconfig's project reference updated; `tsconfig.app` already excludes `src/shared/electron`.
    **Full-app CDP boot smoke:** app-root renders, `window.bridge` + `window.host` (`darwin`) exposed by
    the moved preload, relocated main-process handlers wire up (`ai:auth-status`→`local-login`,
    `source-control:resolve-repository`→`onixlabs-studio`); no module-load errors. `src/` is now
    `{ angular, features, shared }` — no electron code outside `shared`.
  - **NEXT — the last stretch (§1 end state):** relocate the renderer that still lives in `src/angular/`.
    Two unmigrated tab features remain — `repository` (source-control) then `workspace` (directory), in
    that order (they own the dock + the most cross-feature glue) — plus the residual
    `src/angular/services` + `src/angular/components` that belong under `shared/angular` or a feature.
    Follow the proven feature recipe (§9 Step 3). When `src/angular/` empties, `src/` = `features/` +
    `shared/` only and the refactor is complete.
- **Consolidate the inlined `ribbon-row.scss`** into the shared ribbon framework (3 inlined copies now
  — terminal, markdown, code; plus the original still shared by the unmigrated directory +
  source-control ribbons; `styleUrl` can't use aliases, so each migrated ribbon inlines).
- **`repository` (source-control) then `workspace` (directory) last** — the workspace directory-view /
  directory-ribbon still hold the most glue, but with the registries + tasks now shared, their edges
  are feature→shared. `welcome` stays special (shell-slotted, not a tab; injects `RepositoryOpener` →
  a feature→feature edge) — deferred until a shell "start-view" slot or an accepted root straggler.

Note: this section is the portable source of truth — the detailed working notes below (§11) capture
the procedural knowledge that is NOT derivable from reading the code. **Environment note for pick-up:
macOS BSD `sed` does not support `\b` word boundaries** (silently no-ops) — grep does; for symbol
renames use plain case-sensitive `s/OldName/NewName/g` (see the `EditorTerminals` rename).

Note: this section is the portable source of truth — the detailed working notes below (§11) capture
the procedural knowledge that is NOT derivable from reading the code.

## 11. Working notes (hard-won — read before the next move)

### The mechanical relocation recipe (used for every kitchen move and feature stand-up)

Moving a dir/service to `@shared` (or a feature to `src/features/<f>`) is behaviour-preserving
relocation, not a rewrite. Steps, in order:

1. `git mv <src-dir> <dest-dir>` (move the whole directory together so its internal `./sibling`
   imports survive).
2. **Fix the moved files' own up-paths** — a relocated file's own `from '../../../shared/X'` (api
   types) silently retargets wrong after a depth change. After every move:
   `find <dest> -name '*.ts' -exec sed -E -i '' "s#from '(\.\./)+shared/#from '@shared/#g" {} +`
3. **Repoint importers** with a sibling-safe pattern that catches BOTH `../X/X` and `services/X/X`
   forms: `grep -rlE "from '[^']*/<dir>/<base>'" src | while IFS= read -r f; do sed -E -i '' ... ; done`.
   This does NOT catch same-dir `./X` imports — repoint those explicitly when splitting a directory.
4. `prettier --write` the moved/edited files (relocations often surface pre-existing format drift;
   there is one root `.prettierrc`, no path-dependent config).
5. Green-check: `ng build` + `eslint src` + `prettier --check` + `CI=true ng test --watch=false`
   (baseline 6 fails — see §10).

Feature stand-up adds: gate-check the dependency cone → move any foreign kitchen deps to `@shared`
first → sever cross-feature embeds → relocate to `src/features/<f>/angular` → write `<f>.feature.ts`
(`FeatureDescriptor` [+ `chrome`] + `provide<F>Feature` via `makeEnvironmentProviders`) → add ONE
line to `src/angular/config.ts` → delete the feature's `@case` from `content-host` +
`ribbon-strip-container`. Splittable into relocate-then-flip commits.

### Build / toolchain gotchas

- **No `baseUrl`** (TS5090) — alias targets in `tsconfig.json paths` must be relative (`./src/...`).
- **tsc does NOT rewrite path aliases in emit.** The electron **main is esbuild-bundled** (like
  preload) — `--packages=external --tsconfig=tsconfig.json` — so `@shared`/`@features` resolve at
  runtime; `tsc --noEmit` is kept for type-checking only. If you ever revert main to tsc-emit, main/
  feature-electron must use relative imports. esbuild and the Angular builder both read tsconfig `paths`.
- **`styleUrl` paths can't use aliases** (Angular) — when a component moves, either fix the relative
  scss depth or inline the rule. The shared ribbon-row scss is currently **inlined in two migrated
  ribbons** for this reason (consolidate into the shared ribbon framework later — §10 next-step 5).
- **Two "shared" notions collide:** `src/shared/*` (api types, electron) vs the old
  `src/angular/components/shared/*` (atoms). Disambiguate on every move.
- **`FeatureViewInputs` / NG0303:** any view mounted by the registry via `ngComponentOutlet` MUST
  declare `tabId` + `isActive` inputs, or Angular throws NG0303 at mount. (This is why, e.g.,
  `settings-view` gained a `tabId` input it doesn't otherwise use.)

### Angular / lint conventions (match the surrounding code)

- Standalone, **zoneless**, signal inputs/outputs/queries (`input()`, `input.required()`,
  `output()`, `viewChild()`/`viewChild.required()`, `model()`); `@Service()` decorator for DI
  singletons; `ChangeDetectionStrategy.OnPush`. Because it is zoneless, `NgZone.run`/
  `runOutsideAngular` are effectively identity — signal writes drive change detection. Some ported
  code still calls `zone.run` defensively; preserve it on relocation rather than stripping it.
- Strict ESLint: `@typescript-eslint/typedef` (explicit types on members/locals) +
  `explicit-member-accessibility` (every member `public`/`protected`/`private`). Verbose JSDoc on
  every member is the house style — mirror it.
- Barrels re-exporting types need `export type { ... }` (isolatedModules / TS1205).

### Shell (the Bash tool runs zsh — both of these cost a wasted run)

- **`path` is a reserved zsh var tied to `$PATH`.** `for path in …` clobbers `$PATH` and every
  external command dies "command not found". Never loop with `path`/`fpath`/`cdpath`/`manpath`; use
  `p`/`f`/`svc`.
- **zsh does not word-split unquoted `$var`.** `files=$(grep -rl …); for f in $files` runs ONCE with
  the whole blob. Iterate via `grep … | while IFS= read -r f; do …; done`.

### Gate-checking a feature's cone — the blind spots that bit the markdown pass

A grep like `grep -rlE "services/<x>/<x>"` finds importers written as `.../services/<x>/<x>` but
**misses sibling imports** (`../<x>/<x>`, no `services/` segment). Two real consumers hid this way:
`agent-editor-capabilities` → `../markdown-commands` (a **bridge**), and `directory-*` → `../code-*`
(workspace). Always also grep the sibling form: `from '[^']*/<x>/<x>'`.

Likewise, the cone has **inbound** edges, not just outbound: a component elsewhere may _embed the
feature's view/component_. Grep the selector (`app-<x>-view`) and the class import, not only the
feature's own imports — that is how the document-well reuse of the views was missed at first.

Two couplings recur and are the crux of the editor features: **editor command registries**
(`CodeCommands`/`MarkdownCommands` — like the shared `Editors` registry) are consumed by ribbons of
other features and by the agent bridge; and the **document well** reuses editor surfaces. The
markdown pass resolved both (registries stay feature-owned + a sanctioned bridge; well mounts a lean
`documentPanel` via the registry). The code pass must resolve the same two — see §10 next-step 1.

### Where to look first

The commit messages on this branch are detailed and atomic — `git log -p` for any of the §10
wrapper commits shows the exact before/after reasoning. Start a continuation by reading §10's "Next"
list, then this section's relocation recipe.
