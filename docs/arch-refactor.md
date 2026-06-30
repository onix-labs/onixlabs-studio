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

| Shared building block | Today | Consumers |
|---|---|---|
| Dock container/panel system | `components/dock/**`, `services/dock/**` | workspace, repository |
| Terminal component (xterm host) | `views/terminal-view` | terminal, workspace, repository, code-editor |
| Code editor component (Monaco host) | `views/code-view` | code-editor, workspace, repository |
| Markdown editor component (Milkdown host) | `views/markdown-view` + `milkdown/**` | markdown-editor, workspace |
| Agent chat UI | `components/shared/agent-chat` | agent + all 4 docked-agent hosts |
| Ribbon framework | `components/strips/ribbon-strip/*` (not `ribbons/`) | shell |
| Title / status strips, status-bar | `components/strips/{title,status}-strip`, `services/status-bar` | shell |
| Atoms | `components/forms/**`, `components/shared/**`, `icons/`, `styles/` | everywhere |
| **Bespoke 2-pane splitter** | duplicated in code/markdown/terminal views | → componentise into `shared` |
| IPC transport | `preload.ts` (→ generic, §5) | everything |
| Cross-cutting services | `Tabs`, `Theme`, `Display`, `Lifecycle`, `Tasks`, `Output`, `Editors`, `Documents`, `Monaco`, `Terminals`, `agent`/`ai-runtime`/`ai-auth` core | everywhere |

**A feature (recipe) holds the assembly:** a view that *composes* shared components, plus
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

| Wrapper | Wraps | Backing plumbing (also `shared`) |
|---|---|---|
| `<app-terminal>` | xterm (DOM terminal; node-pty is its electron-side backend over the bridge) | pty api contract + electron terminal-manager + `terminals`/`terminal-bridge` |
| `<app-text-editor>` | Monaco | monaco service |
| `<app-markdown-editor>` | Milkdown/ProseMirror | milkdown service |
| `<app-agent>` | the agent chat UI | agent / ai-runtime / ai-auth / agent-sessions + ai bridge |

Because the **shared** wrapper depends on its plumbing, that plumbing is shared too: e.g.
"spawn-and-render-a-pty" is a shared capability, so the terminal *feature* owns little-to-no
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
     readonly id: string;                  // also the tab type, e.g. 'terminal'
     readonly view: Type<unknown>;         // mounted in content-host
     readonly ribbon?: Type<unknown>;      // contextual ribbon, optional
     readonly chrome?: { ribbon: boolean; status: boolean };  // settings = full-bleed
     readonly providers?: Provider[];      // feature-scoped providers (incl. eager glue)
     register?(host: FeatureHost): void;   // optional imperative wiring (dock panels, commands)
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
  on(channel: string, listener: (...args: unknown[]) => void): () => void;  // returns unsubscribe
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
(main→renderer) is driven by main. The generic transport changes *who names the channel*, not
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
  shim) so nothing breaks while only their *location* is still old.

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
  line): **`terminal`**, **`agent`**, **`settings`** under `src/features/<f>/angular`.
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
+ ribbon command handler. Content round-trips via `[content]` in / `(contentChange)` out, with an
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

### Next (in roughly this order)

1. **Stand up `code` + `markdown` tab features** — their wrappers now exist, so the views can move
   to `src/features/<f>/angular` by the proven terminal/agent/settings template (gate-check cone →
   relocate + repoint → `<f>.feature.ts` + `provide<F>Feature` → one `config.ts` line → delete any
   `@case`).
2. **`<app-diff-editor>`** — the source-control diff view (`createDiffEditor`, two read-only models)
   is a *separate* variant that shares the Monaco service + theme plumbing but not the component.
3. **Promote `Documents` + `change-margins` to shared** (text-document services used by both code
   and markdown — else a markdown→code edge).
4. **Generic `Bridge` + `shared/electron` carve** (§5) — terminal pty backing (`terminal-manager`
   electron + pty channels) is still in `src/electron` + the god IPC trio; carve into
   `shared/electron` + `shared/api` as a focused step.
5. **Consolidate the inlined `ribbon-row.scss`** into the shared ribbon framework (2 copies now —
   `styleUrl` can't use aliases, so each migrated ribbon inlined it).

`welcome` remains special (shell-slotted, not a tab; injects `RepositoryOpener` → a feature→feature
edge) — deferred until a shell "start-view" slot or an accepted root straggler import.

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

### Where to look first

The commit messages on this branch are detailed and atomic — `git log -p` for any of the §10
wrapper commits shows the exact before/after reasoning. Start a continuation by reading §10's "Next"
list, then this section's relocation recipe.
