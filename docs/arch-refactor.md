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
