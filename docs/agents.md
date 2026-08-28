# ONIXLabs Studio — Agent Guide

The single source of truth for anyone (human or AI) working on **ONIXLabs Studio**, a TypeScript /
Angular / Electron desktop IDE. It covers the codebase architecture, the conventions your code must
follow, and how to build, test, and verify changes.

> **Code is clean if it can be read, and enhanced by a developer other than its original author.**
> Every line must justify its existence through clear naming and thorough documentation of _why_ it
> exists.

---

## 1. Stack at a glance

- **Angular 22, standalone + zoneless.** Signals are the reactive model; there is no Zone.js. A
  `@Service()` decorator (= `@Injectable({ providedIn: 'root' })`) marks DI singletons.
- **Electron**, main + preload written in TypeScript and **esbuild-bundled** (not `tsc`-emitted);
  `tsc --noEmit` type-checks them.
- **Vitest** for tests; **ESLint** (typed rules) + **Prettier** (`printWidth: 100`) enforce the
  house style mechanically.
- Node is pinned via `.nvmrc` (currently `24.16.0`) — run `nvm use` before working.

---

## 2. Repository architecture — feature-first

`src/` contains **exactly two** subdirectories:

```
src/features/<feature>/{angular,electron,api}   ← recipes: compose shared parts
src/shared/{angular,api,app,electron}           ← kitchen: runtime + reusable parts
```

The eight features are `workspace` (the `directory` tab), `repository` (`source-control`), `code`,
`markdown`, `terminal`, `agent`, `settings`, and `welcome`. `settings` and `welcome` are leaf
consumers of shared infra modelled as features for uniformity.

### The two invariants (non-negotiable)

1. **No feature code lands in `shared`.** `shared/{angular,api,electron}` must not name or import any
   feature. (`shared/app` — the assembler — is the sole exception; see below.)
2. **Features are isolated like plugins.** Everything a feature needs lives under
   `src/features/<feature>/`; a feature imports only `@shared/*` and `@features/*`, never a sibling
   feature's internals by relative path. Removing a feature's folder removes the feature — the only
   permitted straggler is **one line** in `src/shared/app/config.ts`.

> **Enforced, not just documented.** INV2 is mechanically checked by ESLint. `eslint.config.js`
> generates a per-feature `@typescript-eslint/no-restricted-imports` rule that bans importing a
> _sibling_ `@features/<other>/*` — a feature may import only `@shared/*` and its own
> `@features/<self>/*`. A cross-feature import fails `npm run lint`. The fix is always to **promote
> the shared surface to `@shared`**, never to add a cross-import (precedent: `MarkdownCommands` →
> `@shared/angular/services/markdown-commands`, `CommitDetail` →
> `@shared/angular/components/panels/commit-detail`).

### Kitchen vs recipe

`shared` is a kitchen stocked with reusable capability components, framework, atoms, cross-cutting
services, and the generic IPC transport. Features are recipes: a leaf view composes shared parts plus
its own ribbon / commands / status glue and its own `api`/`electron` surface.

### `shared/app` — the assembler

`src/shared/app` is a deliberately tiny sibling of `angular`/`api`/`electron`. It is the **only** code
allowed to name features, because it is the composition root:

- `config.ts` — the feature enumeration (seven `provide<F>Feature()` calls; `welcome` is mounted
  directly by `root`). This is the one place that lists features; delete a feature = delete its folder
  - remove its line here.
- `root/` — the `app-root` component that mounts the shell chrome + the active tab's view.
- `main.ts` — the Angular bootstrap. `global.d.ts` — the ambient `Window.bridge`/`host` types.
  `index.html` — the HTML entry.

---

## 3. Shared capability wrappers — the load-bearing contract

The kitchen's capability components are **thin wrappers around exactly one engine each** — no
splitter, no side panels, no ribbon, no embedded agent:

| Wrapper                 | Wraps                    | Backing plumbing (also in `shared`)                            |
| ----------------------- | ------------------------ | -------------------------------------------------------------- |
| `<app-terminal>`        | xterm (node-pty backend) | pty api contract + electron terminal-manager + terminal-bridge |
| `<app-text-editor>`     | Monaco                   | monaco service + `Editors` (model-URI → document registry)     |
| `<app-markdown-editor>` | Milkdown / ProseMirror   | milkdown service + plugins                                     |
| `<app-agent>`           | the agent chat UI        | agent-runtime / ai-auth / agent-sessions + the ai bridge       |

Because a shared wrapper depends on its plumbing, the plumbing is shared too — so the terminal
_feature_ owns little-to-no unique `electron`/`api`; it composes the shared capability.

**Feature views are leaves** that compose the shared panel layout with these wrappers:

```
terminal-view = layout{ main: <app-terminal>,        side: <app-agent> }
code-view     = layout{ main: <app-text-editor>,     sides: <app-terminal>, <app-agent> }
markdown-view = layout{ main: <app-markdown-editor>, sides: outline/review/reader, <app-agent> }
```

Do **not** sub-divide a capability wrapper or "improve" it while touching it. It is the kitchen.

---

## 4. The runtime seams

These mechanisms are why a feature is a deletable plug-in. Know them before adding or changing a
feature.

### 4.1 Feature registry (tab views, ribbons + status)

`shared/angular/services/feature-registry` holds a multi-provider `FeatureRegistry` keyed by tab-type
string. Each feature contributes a descriptor:

```ts
interface FeatureDescriptor {
  readonly type: string; // the tab-type identifier and registry key, e.g. 'terminal'
  readonly view: Type<unknown>; // mounted per tab; MUST declare tabId + isActive inputs
  readonly ribbon?: Type<unknown>; // contextual ribbon shown while the tab is active
  readonly status?: Type<unknown>; // status strip shown while the tab is active
  readonly documentPanel?: Type<unknown>; // lean editor surface for a document well, if any
  readonly chrome?: Partial<{ ribbon: boolean; status: boolean }>; // e.g. settings = full-bleed
}
```

A feature exposes `<f>.feature.ts` = `provide<F>Feature()` returning
`makeEnvironmentProviders([provideFeature(descriptor), …eager initializers])`, and adds one line to
`config.ts`. The shell (`content-host`, `ribbon-strip-container`, `root` chrome gating) is **purely
registry-driven** — it looks the active tab's type up in the registry via `ngComponentOutlet` and
contains no `@switch` on tab type and no feature-type string.

> **NG0303:** any view mounted by the registry MUST declare `tabId` and `isActive` inputs
> (`FeatureViewInputs`), or Angular throws at mount — even if the view ignores them.

`welcome` is the exception: it is shell-slotted (`root` mounts `<app-welcome-screen>` directly, it is
not a tab type), which is why it has no descriptor.

**Chrome belongs to the active view, never to a registry.** The ribbon and the status strip are both
mounted for the active tab and destroyed on a tab switch, so neither can describe a view the user is
no longer looking at. They differ only in how they reach view state:

- A **ribbon** is created in the shell's injector, so it drives the view through a per-feature command
  registry the active view registers a handler with (`ApiExplorerCommands`, `ContainersCommands`, …).
- A **status** component is created through the view's OWN injector, published while the view is
  active by `createViewInjectorRegistrar({ isActive })` into `ViewInjectors` (keyed by tab id). It
  therefore injects the view's per-tab services directly (`ApiWorkspace`, `Workspace`, `CodeStatus`)
  with no forwarding registry, no owner keys, and nothing to clear. A worktree container tab's
  sub-views share one tab id, and the _selected_ checkout's injector is the one published.

> ⛔ Do **not** push a view's status into the shared `StatusBar`. That registry is for **ambient**
> segments only — app-wide facts that outlive any tab, like the running-container count. An owner key
> there survives the view that set it, which is exactly how a closed editor left `Ln 1 Col 1 LF UTF-8`
> stranded over Mission Control. View status goes in the feature's `status` component.

The strip renders the view region (feature status, or the active tab's title as a fallback), then the
ambient region (`StatusBar` segments, the language-server drop-up, the notification bell). Segments
are always composed from `app-status-strip-segments` / `app-status-strip-segment` — a feature never
emits status markup of its own. A document well additionally has its own strip (`DockStatusStrip`,
fed by `DocumentStatus`) describing the active document in that well; the window strip describes the
active tab.

### 4.2 The dock (per-tab panel catalogue + layout)

`shared/angular/{services,components}/dock` is a generic docking framework that names no feature
panel. A tab specialises its dock by providing a `DockBlueprint` via the `DOCK_BLUEPRINT` injection
token: `createLayout()` returns the initial `DockNode` tree, and `panels[]` is the catalogue the
`DockPanelRegistry` seeds from. The workspace tab provides `WORKSPACE_DOCK_BLUEPRINT`, the repository
tab `REPOSITORY_DOCK_BLUEPRINT` — each cataloguing its own feature panels. `defaultLayout()` (pure ID
strings) stays in the dock; the panel _components_ are contributed by the blueprint.

**Two drag gestures, and the difference is what moves.** A group's **title bar** (or a document
well's grip, standing in for the title bar it does not have) docks the **active panel** alone; the
group's **tab rail** docks the **whole group**, every tab travelling with it — tool stacks and
document wells alike. A tab itself keeps its own CDK drag (reorder within a strip, move between
same-role strips), so the rail gesture only starts on the rail's own surface. Both run through
`DockDrag` — `begin()` for a panel, `beginGroup()` for a group — and resolve against the same
compass, a group docking by its stack's role exactly as a panel docks by its own. A group move is a
single `DockState` commit (one undo step), and a group released over nothing stays where it is:
the floating layer and pop-out windows hold single panels, so neither can take a group.

### 4.3 IPC — a generic bridge

The preload exposes a **dumb pub/sub transport**, so it can live in `shared` without naming features:

```ts
// src/shared/api/bridge.ts — the only IPC contract in shared
interface Bridge {
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (...args: unknown[]) => void): () => void; // returns unsubscribe
}
// exposed as window.bridge by src/shared/electron/preload.ts — imports zero feature code
```

Per-domain slices live in `src/shared/api/<domain>-channels.ts` (a channel enum + payload types + a
`<Domain>Client` interface). A per-domain `@Service()` client in `shared/angular` wraps `window.bridge`
and exposes a nullable ops object, so consumer call-sites don't change when the transport does. The
"am I in Electron?" probe everywhere is `window.bridge !== undefined`.

`window.host` (`src/shared/api/host.ts`) is the **static/synchronous** counterpart — platform and
display startup facts the async bridge can't carry before the first paint (read pre-bootstrap in
`main.ts`).

**Security is preserved and non-negotiable.** The renderer is untrusted: every main-process handler
validates its arguments, an `invoke` to an unregistered channel rejects, and `send` is driven by
main. The generic transport changes only _who names the channel_, not the validation guarantees.

### 4.4 Path aliases

`tsconfig.json` `paths` map `@shared/*` → `src/shared/*` and `@features/*` → `src/features/*`,
honoured by the Angular esbuild builder, `tsc`, and the preload/main esbuild steps (pointed at the
tsconfig via `--tsconfig`). Use aliases for cross-unit imports; keep `./sibling` relatives only
within a directory. Aliases make files location-independent, so moves are cheap.

### 4.5 Keybindings (keyboard accelerators)

`shared/angular/services/keybindings` holds a generic `Keybindings` registry that names no feature. A
view registers its chord→command bindings under its tab id **in the same activation lifecycle where it
registers its ribbon command handler**, and clears them on deactivation (`deactivate`) and disposal
(`forget`). Only the active scope dispatches. The shell installs the sole listener: `root` has one
`window:keydown` HostListener → `keybindings.dispatch`, at the **bubble phase** so an embedded editor
(Monaco, Milkdown, xterm) consumes the keys it owns first — only chords it leaves unhandled reach the
router, and the allowlist never intercepts incidental typing. Chords use the platform-neutral `Mod`
modifier (⌘ on macOS, Ctrl elsewhere). **In the terminal, bind only `Mod+Shift` chords** — a bare
`Mod` is Ctrl on Windows/Linux and collides with the shell's own control codes.

**The editing chords do not come from here.** On macOS the application menu is the only thing binding
Undo/Redo/Cut/Copy/Paste into the window at all, so `CoreMenu` carries them as native roles and a
menu accelerator fires **before** the renderer sees the key. A tab that binds one of those chords to
something of its own — files in the explorer, the shell in a terminal, an editor's model-level undo —
therefore takes it from every text box on the tab unless it also declares `editingRole` on the menu
entry, which defers to the platform's behaviour while `focusedTextInput` finds a focused text box
(`shared/angular/services/editing-chords`). Such an entry must never be `enabled: false`: a disabled
entry's accelerator is dead. Select All is the exception — it is served by `EditingChords` from the
window listener rather than the menu, because a Select All entry would own ⌘A and take it from the
editors that bind it to their own selection model.

### 4.6 Project systems, capabilities & `.studio`

The directory workspace is **language-agnostic**: it never hard-codes an ecosystem. A `ProjectSystem`
provider (`shared/electron/project-system`, e.g. `dotnet`, `node`) turns a workspace root into a
`ProjectModel` _and_ declares a **capability descriptor** — `actions` (Build/Clean/Rebuild…),
`buildConfigurations`, a `target` axis, and a `debug` adapter. A provider **never infers run
configurations** from a root: what to run is authored, not guessed.
The model (with its capabilities and kind) travels to the renderer over `ProjectChannel.ModelLoad`;
adding an ecosystem means adding a provider, **never touching the shell or ribbon**.

Three renderer seams carry the active workspace's state to the root ribbon. Each is an **app-level
singleton** — the ribbon lives above the tabs, so it can never inject a tab's scoped services. They
resolve the active tab's workspace instead: `WorkspaceCapabilities`/`Builds` are _registered into_ by
the active tab's per-workspace services (mirroring how a tab registers its build handler), while
`StudioConfig` reads the active root from the `ActiveWorkspace` seam. Injecting the scoped `Workspace`
here is a bug — its root is never set at the root injector, so `.studio` would never load.

- **`WorkspaceCapabilities`** — the active model's capabilities + provider kind. The Solution group
  gates Build/Clean/Rebuild on `actions`; the Target group's configuration/target selectors are driven
  by `buildConfigurations`/`target` and hidden when absent. **An undeclared action is not rendered, not
  greyed** — and the group goes with the last of them, so an ecosystem with no build step (Python) shows
  no dead buttons. Actions may be **per root** where the root decides them: Node declares the actions
  its manifest's conventional `build`/`clean`/`test` scripts back. Capabilities are authoritative; a
  root with no provider falls back to discovered tasks so Gradle/Make still build.
- **`Builds`** — dispatches to the active workspace's `BuildRunner`: `build()` (the first discovered
  build task, the fallback for a root with no capability model), `runConfiguration()` (a `.studio` run
  configuration compiled to a command), and `runAction()` (any declared action, compiled per
  ecosystem — the path every declared Build/Clean/Rebuild takes). Discovered tasks back the Solution group only
  — they never reach the Run dropdown. **Runs are concurrent**: `activeRuns` lists every in-flight run,
  `cancel(runId)` stops one and `cancelAll()` stops the lot; the ribbon's Start becomes a Stop
  split-button whose menu stops a single run. Cancelling kills the task's whole **process tree**
  (POSIX process group, `taskkill /T` on Windows) with a `SIGKILL` escalation — signalling only the
  wrapping shell leaves children holding the output pipes open, so the run never appears to end. A run configuration streams into its own
  Output channel (`run:<id>`) so parallel runs stay readable; build/test/action output shares `build`.
- **`StudioConfig`** — the active workspace's `.studio` persistence.

**`.studio`** (`shared/electron/studio`, platform-neutral model in `shared/api/studio.ts`) persists
run configurations per project: `workspace.json` is shared and committed (the run configurations);
`workspace.user.json` is git-ignored and holds only transient selections (last configuration, target,
build configuration). The main-process `StudioStore` owns atomic reads/writes and seeds a `.gitignore`
entry on first write; it never authors run configurations itself. The renderer reloads on external
edits through the directory-watch feed, guarding against its own writes. The Run group's dropdown lists
exactly the configurations `workspace.json` declares — a workspace with none has nothing to run — and
the Configure dialog edits them. A configuration that names `members` is a **compound**: starting it
starts each member as its own run, in parallel (`expandRunConfiguration` resolves them, tolerating
unknown members and cycles), so each member stays individually stoppable.

**Authoring is either by hand or by agent — never inferred.** The Configure dialog's **Auto-configure**
and **Ask agent** buttons dispatch to the _active workspace's own agent_ (`RunConfigurationAgent`
resolves the active tab's live `AgentHost`), so the work runs in the agent the user already has: its
transcript appears in the Agent panel and Mission Control, and it inherits write confinement, per-tool
policy, and the audit log. The agent writes through three project/editor-surface MCP capabilities —
`list_run_configurations` (read-only, auto-allowed), `save_run_configurations`, and
`delete_run_configurations` (gated writes) — handled in the renderer against `StudioConfig`, so the Run
dropdown and the dialog update as the agent works. Every write is validated as a whole
(`findRunConfigurationIssues`: duplicate ids, members naming nothing, compound cycles) and refused with
a reason the agent can act on. The dialog is modal, so it renders the agent's own pending
permission prompts inline (`AgentRequestCard`) — otherwise a run blocked on "Allow Bash?" would stall
behind it, unanswerable.

### 4.7 Debugging (DAP)

Debugging is built on the **Debug Adapter Protocol**, mirroring the LSP subsystem's shape. DAP is _not_
JSON-RPC — it shares LSP's `Content-Length` framing but uses a `{seq, type, command, request_seq}`
envelope, and (unlike LSP) the adapter's `initialized` event fires _after_ the client sends `launch`.
The client, session manager, adapter registry, and provisioner live in `shared/electron/debug`; the
`Debugger` app-level seam and per-workspace `DebugSession` mirror `Builds`/`BuildRunner`.

- **Adapters differ in transport, hidden behind one surface.** `DapClient` speaks DAP over a `DapTransport`
  — `StdioTransport` for a spawned process (netcoredbg), or `TcpServerTransport`/`TcpClientTransport` for a
  debug _server_ reached over TCP (js-debug). Everything the manager drives goes through the
  `DebugAdapterConnection` interface, so the renderer treats every adapter as one linear session.
- **js-debug is a compound session.** js-debug is not a single adapter but a server hosting a _tree_ of
  DAP connections: a parent the debuggee is launched on, and one child _target_ session per process, each
  started via a `startDebugging` reverse request. The real debugging happens on the targets. `JsDebugSession`
  hides the whole tree behind `DebugAdapterConnection`: it answers the parent's `initialized`/`startDebugging`
  internally, surfaces the first target's `initialized` (so the renderer sends breakpoints once), routes
  requests to the active (last-stopped) target, replays breakpoints to later targets, and reports terminated
  once every target has. The Node project system declares `debug: { adapter: 'js-debug' }` and resolves the
  launch target to the package's `main` entry (confined to root; no build — Node is interpreted).

- **Adapters are provisioned, not vendored.** `DebugProvisioner` (mirror of `LspProvisioner`) first
  _locates_ an adapter (override → project-local `node_modules/.bin` → PATH), then _ensures_ a
  downloadable one: it fetches a **pinned, SHA-256-verified** archive per `${platform}-${arch}`,
  extracts it under `userData/debug-adapters`, and caches it. Each platform entry carries its own URL
  and checksum — upstream may publish different releases per platform (e.g. netcoredbg dropped
  `osx-amd64` after 3.1.3, so Intel Macs pin an older release than Apple Silicon).
- **.NET uses netcoredbg, never vsdbg.** vsdbg (the Microsoft C#/VS debugger) is licensed for use only
  inside Microsoft's own products — shipping it here would violate its EULA. netcoredbg (Samsung, MIT)
  is the license-clean adapter and is what the `dotnet` project system declares
  (`debug: { adapter: 'netcoredbg' }`).
- **Launch targets resolve in main.** The renderer never builds a project or locates an artifact.
  `DebugLaunchResolver` (`DebugChannel.Resolve`) delegates to the owning project system's
  `resolveDebugTarget`, which is **confined to the open workspace root**; for .NET it compiles the
  project (defaulting to the Debug configuration so symbols exist) and reads its `TargetPath` from
  MSBuild. `DebugSession` folds the returned program/cwd into its DAP `launch` request.
- **Breakpoints** persist per developer through `SettingsStore` (`debug.breakpoints`); adapter-reported
  verification is layered on transiently and never persisted. The gutter and current-execution-line
  marker live in the **shared code-document core** so both the well and standalone code leaves show them.

### 4.8 Multi-window (pop-out panels)

Studio is one Angular application in one **main window**, plus secondary OS windows that are always
**viewers over state owned elsewhere** — never second owners.

- **`WindowManager` (main)** owns every `BrowserWindow`: a kind-aware registry
  (`main` | `popout` | `modal`, the last being §4.12's dialog windows), per-kind bounds persistence
  (`window-state.json`, off-screen bounds re-centred; modals persist nothing), and
  `applyWebContentsSecurity` on every window it creates or adopts. Push-style IPC still targets the
  main window by default; invoke-style handlers reply to their caller and are window-agnostic.
- **One pop-out mechanism, one chrome.** The dock group title bar offers pop-out (cards icon)
  through the per-view `PopoutPanels` seam, handled by `PanelPopout` for **every panel**: a
  **same-renderer auxiliary window** — one of the two `window.open` targets the security guards
  allow (`AUX_PANEL_URL`, the other being §4.12's `MODAL_WINDOW_URL`); everything else is still
  denied (#116). The child shares the renderer process,
  so the panel component renders into the child's document **with the owning view's injector** and
  keeps its real services; `AuxiliaryWindows` mirrors stylesheets and theme attributes into open
  children. No per-panel data plumbing exists — do not add mirrors or per-window IPC routing for
  popped panels. The terminal panel works this way too: its panes live in the opener's JS context
  wherever their DOM renders, so PTY output keeps flowing over the main window's bridge, and a
  popped pane re-attaches through the same scrollback replay as any remount (the pop-out never
  disposes a PTY — panes are `persistent`).
- **Pop-out windows are real docks.** A pop-out window is titled after the workspace (or
  repository) and hosts a full `DockContainer` via `PopoutDockHost`, whose component providers
  scope a fresh set of dock services (state, geometry, drag, floating, auto-hide, focus, reveal, a
  handler-less `PopoutPanels`) to the window — including `DOCUMENT` overridden to the child's —
  while the panel registry, tab context, and every panel's backing service resolve through the
  parent chain to the owning view. Window layouts are ephemeral (`DockBlueprint.key` is optional;
  no key → no persistence). Closing a window returns every panel it hosts to the main-dock
  position it left; closing a panel _inside_ a window closes it exactly as the main dock would.
- **Window-scoped CDK.** `PopoutDockHost` also provides `OverlayContainer`, the outside-click
  dispatcher, `ScrollDispatcher`, `DragDropRegistry`, and a fresh-measuring `ViewportRuler`
  subclass (`windowScopedCdkProviders()`, shared with modal windows). CDK resolves these through the triggering element's injector (`createOverlayRef` /
  `createDragRef`), so menus and overlays opened from a popped panel render in ITS window (and
  close on outside clicks there), CDK tab drag-reorder tracks the child document, and positioning
  measures the child viewport. Main-window triggers keep resolving the root instances — never
  route overlays across windows by hand.
- **Keyboard accelerators per window.** Accelerators enter through one bubble-phase `keydown`
  listener per window: the shell's (`Root.onWindowKeydown`) for the main window, and one
  `PanelPopout` attaches to each pop-out, dispatching with the OWNING view's scope
  (`Keybindings.dispatch(event, scope)`) so chords act on that view even while another tab is
  active in the main window. Bubble phase keeps editor-first semantics — an embedded engine
  consumes the keys it owns before the router sees them.
- **Drag gestures.** A tool tab dragged beyond its window's edge **tears out** into a new pop-out
  at the drop point (`DockDrag.registerExternalDrop`; the requested position rides the
  `window.open` features string, parsed and display-clamped by the main process). Dropped onto an
  open pop-out window, it **joins that window's dock**; dragged out of a pop-out over the main
  window, it returns to the position it originally left. Hit-testing uses the child windows' own
  screen rects and only engages outside the source viewport, so overlapping windows never shadow
  in-window drops; in-window void drops still float, and document tabs never tear out.
- **Move, not clone.** A panel (and a terminal session) renders in exactly one window; closing a
  pop-out docks the panel back to the stack/index it left. Closing the main window quits the app;
  pop-outs never gate lifecycle. `DockReveal` focuses a popped panel's window instead of touching
  the dock. Run configurations may declare `presentation: 'window'` to pop the terminal panel on
  launch.
- **Cross-window sync** rides `SettingsStore.onExternalChange` (localStorage `storage` events, which
  fire only in non-writing windows — the built-in echo guard); `Theme` and `Settings` re-apply
  external changes live.

### 4.9 Worktree containers (multi-branch workspaces)

A **worktree** is Studio's product concept, deliberately NOT git's `worktree` feature: a container
directory holding **independent full clones** of one repository (GUID-named checkout directories,
each on its own branch) plus `.studio/worktree.json` (the container's self-identification and
checkout registry — unrelated to a checkout's own committed `.studio` run configurations). The
model, defensive parsing, and strict checkout-id validation live in `@shared/api/worktree`; the
disk/git mechanics in the Electron-free `WorktreeOperations` (promotion moves the entire working
copy — including its `.studio` — into the first checkout, in place and rolled back on failure;
removal goes to the OS trash, never a hard delete), wrapped by `WorktreeManager` behind
`WorktreeChannel`.

- **The host decides what a tab is.** The `directory` tab type mounts `DirectoryHost`, which
  resolves the opened folder's kind (`worktree` → `workspace` → `folder`, container first) before
  any view exists. Single mode renders one `DirectoryView` exactly as before; container mode
  renders **one kept-alive `DirectoryView` per visited checkout** — mount-all/hide-inactive one
  level down, created lazily on first activation — so switching checkouts is **purely visual** and
  every checkout keeps its documents, terminals, agent conversation, and debugger state.
- **`WorktreeSession`** (host-provided, one per tab) is the shared container state: descriptor,
  per-checkout statuses, the active-checkout selection, add/remove mutations, and **host root
  ownership** — roots the host registered (the container, each opened checkout) are "claimed", and
  a sub-view whose root is claimed releases local state on destroy (`Workspace.releaseFolder`)
  instead of closing the root. Never close a claimed root from a view.
- **Sub-view identity is the view scope** (`tabId` alone, or `tabId:checkoutId`): it keys
  keybinding scopes, pop-out dispatch (`DockTabContext.tabId`), and status-bar owners, so
  a container's sub-views never collide on scope-keyed registries. Anything needing the REAL tab
  id (agent-host registration, document ownership, `ActiveWorkspace`) still uses the raw input.
- **Presets key on the container**: a checkout's dock reads its layout pick from the container
  path (`DockTabContext.presetRoot`), so all checkouts of one container share one pick. The
  Worktrees panel is catalogued for every workspace tab but synced into the layout only while the
  tab is a container; checkouts are labelled by alias or branch, **never by GUID**.

### 4.10 Notifications (toasts + the status-strip centre)

`shared/angular/services/notifications` is the app-wide notification store. `app-toast-host`
(slotted in `root`) renders its toast stack bottom-right above the status strip; the status-strip
bell opens its bounded history flyout. Raise events with `Notifications.notify()`:

- **Severity** (`info|success|warning|error`) drives the icon, colour, and default stickiness: an
  `error` toast stays until dismissed — **a failure must never vanish silently** — everything else
  auto-dismisses after `notifications.toastDuration` (hover pauses the timer).
- **Route** picks the surfaces: `default` (toast + history), `history-only` (record without an
  interruption — used when the source is already on screen), `toast-only` (transient state that
  would be stale as a record, e.g. an agent ask; retract it with `dismissByKey`).
- **Coalescing `key`** — a repeat outcome replaces its live toast in place (a retried push), keyed
  per source **and root** so parallel workspaces never coalesce each other's outcomes.
- **Main window only, by design.** Pop-out windows share the renderer, so an action taken in a
  pop-out raises through the same singleton and its toast renders in the main window. Never add
  per-window toast hosts or notification IPC.
- **User-initiated endings stay silent.** A cancelled run, a stopped agent turn: no toast — ending
  it was the user's own action. Anything ending on its own always surfaces (or lands history-only
  when its surface is visible).
- Sources today: `Repository` (network ops + the commit → Push offer, wired at the mutate funnel so
  every commit surface is covered), `BuildRunner` (run/build exits, with a Show-terminal action),
  `Agent.onStatus` (attention-aware: history-only while the owning tab or Mission Control is
  active), and `AgentRequestToasts` (pending asks, behind `notifications.agentRequestToasts`; the
  title-strip inbox itself is gated by `notifications.agentRequestsInTabList`).

### 4.11 Workspace ribbon (command seams + layout presets)

A contextual ribbon is rendered by the **shell**, not inside the view it acts on, so it resolves the
_root_ injector. A workspace tab's state — its document well, its repository, its search — lives in
per-view services provided by `directory-view`, which the ribbon therefore **cannot inject**. Every
workspace ribbon control routes through a registration seam instead: the active view registers a
handler while it is active, the ribbon calls the seam, and the seam forwards to whichever view is
registered (or does nothing when no directory tab is active).

- `WorkspaceDocumentCommands` — File group: `save`, `saveAll`, plus `canSave`/`hasUnsavedChanges`
  signals that gate the buttons.
- `WorkspaceSourceControlCommands` — the everyday git actions (commit, push, pull, open in source
  control), with `hasRepository` gating the whole Source Control group.
- `WorkspaceFind` — reveals the multi-file Search panel.
- `SourceControlCommands` — the repo-global remainder: `fetch`, `stash`, and the worktree promotion
  pair. Deliberately small; it shrank as the panels took over the selection-scoped actions.

> **Ribbon or panel?** The ribbon carries only actions that are repo-global and act on no selection
> — Commit (which sets the stage rather than committing), the network trio, Promote. Anything acting
> on something the user can see and select — a branch, a stash, an individual change, the diff
> layout — belongs on that thing's panel, as a row action or a `PanelToolbar` button.

A panel owns its tool strip by declaring `ownsToolStrip: true` on its `DockPanel` and rendering
`<app-panel-toolbar>` itself; the dock then omits the generic strip (whose `DEFAULT_TOOLS` are
presentational stubs). The Repository rail owns branch creation and the stash actions; the Commit
panel owns the diff-layout toggle and Discard All. Both are catalogued in
`REPOSITORY_DOCK_BLUEPRINT`, which the workspace merges into its own catalogue — so a panel flagged
there is flagged for every surface that shows it.

> **Two seams, one group.** `WorkspaceSourceControlCommands` and `SourceControlCommands` are both
> registered by `directory-view` and both consumed by the ribbon's Source Control group; the split is
> historical (the first was the workspace's everyday facade, the second the retired repository view's
> wider one) rather than a design boundary. Merging them is a fair future cleanup.

> **Adding a workspace ribbon control?** Add a method to the matching seam and register it in
> `directory-view` — never inject a view-scoped service into a ribbon. A control that appears to do
> nothing at runtime is almost always this mistake.

**Editor commands reach well documents by document id.** `CodeDocumentPanel` registers an
`EditorCommandHandler` with `EditorCommands` under its document id (activating and standing down with
the well's active document, forgetting it on destroy) exactly as a standalone code tab registers under
its tab id. This is what lets the ribbon's Edit group — the clipboard and history pairs, Find, and the
tidying pair (Format / Code Cleanup) — and its save actions act on the focused well document; without
the registration they resolve no handler and are silent no-ops. The tidying pair lives in **Edit**, not
behind Solution's Clean: it tidies a document, not a build, and Solution disappears entirely for an
ecosystem with no build step.

**Layout presets** (`shared/angular/services/layout-presets`) name _which panels exist and where they
dock_. The persistence model is deliberately narrow — three things and nothing else:

- **Definitions are app-wide**, agnostic to the loaded workspace (`layout.presets`). Built-ins are
  immutable: fork them with Save As rather than updating in place.
- **Each workspace root remembers its active pick** (`layout.active-presets`).
- **One preset is the app-wide default** (`layout.default-preset`) — the View button's target, and
  what a root falls back to before it has a pick. A default **always exists as long as any preset
  does**: with none chosen the first preset stands in, so `defaultId()` never answers "none".
  Deleting the default clears the choice rather than stranding it.

Session layout is **ephemeral by ruling**: closing, moving, or resizing panels writes nowhere, and
every launch, preset switch, and reset re-applies the active preset's saved definition. Save As and
Update are the only writes. The active view registers a `LayoutPresetSession` (exactly as it registers
its build runner) through which the ribbon captures the current layout and re-seeds the dock.

### 4.12 Modal windows

**Every modal is a real window.** `app-modal` does not draw an overlay over the window that raised
it; it opens a child `BrowserWindow` and renders its content there, with the raising window blurred
and inert behind it (`ModalBackdrop` + `app-modal-backdrop`, refcounted so a modal over a modal
keeps it up). It is the §4.8 pop-out mechanism with a different intent — the second (and last)
`window.open` target the security guards allow, `MODAL_WINDOW_URL`; the main process gives it dialog
chrome (`hiddenInset`, no minimize, resizing and closing only when the modal asks) and parents it to
the opener. Modal bounds are never persisted: a modal opens sized to what it currently holds.

- **Content is a marked template.** Callers write `<ng-template appModalContent>`, never plain
  projection: the template is instantiated in the modal's window under `ModalWindowHost`, whose
  providers scope the CDK layer (`windowScopedCdkProviders()`, shared with `PopoutDockHost`) and
  `DOCUMENT` to that window. That is what makes a menu, an overlay, or a drag inside a modal happen
  in ITS window. Bindings and handlers still act on the component that declared the template — the
  content keeps the view's services, exactly as a popped-out panel does. The marker is required
  because modal content routinely contains templates of its own (a CDK menu panel); an unmarked
  query would seize one. `<ng-content>` inside the template works, which is how the markdown form
  modal carries each caller's projected fields across.
- **Sized by intent.** A dialog is _measured_: the window fits its content and re-fits as the
  content changes. `expandable` makes it _filling_ instead: a user-resizable window whose content
  takes the room it is given, at `height` (or a share of what is available). The measured path needs
  a non-stretching content wrapper, or the measurement is just the window's current height. Either
  way the size is held within `minWidth`/`minHeight`/`maxWidth`/`maxHeight` (rem, and the window's
  real resize limits) and within 90% of the space available — the window it is raised over, or the
  display when it is free-standing, since a hidden opener may be far smaller than the modal standing
  in for it. A stated minimum outranks the available space: a modal that cannot fit is better
  oversized than unusable.
- **A modal raised from inside a modal is DECLARED inside it.** Nest the `<app-modal>` within the
  outer modal's `appModalContent` template and it belongs to that window: it resolves the host's
  `DOCUMENT` and `ModalBackdrop`, so it opens from that window, parents to it, and dims it. Declared
  as a sibling it is instead raised from the window its component lives in — which for the welcome
  screen is the HIDDEN main window, and attaching a child to a hidden window (or handing focus back
  to it as the child closes) puts that window on screen. `adoptModalWindow` refuses a hidden parent
  as a backstop, but the declaration is what makes the dialog dim the right window.
- **Measuring a window is timing-sensitive, in two ways.** The host view is rendered synchronously
  (`detectChanges`) before it is measured and observed: an unrendered host measures as nothing, which
  would collapse the window to its minimum with no observer attached to correct it. And the window's
  chrome is measured ONCE and remembered — a window part-way through a resize reports a fresh outer
  size against a stale inner one, so the difference is not chrome at all (it can be negative), and a
  refit landing on that frame would shrink the window inside its own content.
- **Theming crosses the window boundary by copy.** Custom properties whose value at the call site
  differs from the document root's are written onto the modal window's **body** — not its root,
  whose `style` attribute `ChildWindowStyling` mirrors from the opener and would overwrite. App-wide
  tokens are left to resolve live from the mirrored stylesheets, so a theme switch reaches an open
  modal.
- **Dismissal is the window's, plus the backdrop's.** A modal window closes on Escape (handled in
  its own document), on its own close button, and on a click on the backdrop over the window behind
  — the last belonging to the topmost modal alone, which is why `ModalBackdrop` stacks the open
  modals rather than counting them. A modal that is not `dismissable` ignores all three.
- **The welcome screen is the special case.** With no tabs open it IS the application: `ShellPresence`
  hides the main window, and the welcome modal is `freestanding` — no parent (a child of a hidden
  window is not displayed at all on macOS), no backdrop, and centred on the display rather than on
  its hidden opener. Closing that window closes the application through the main window's own quit
  protocol. The main window is shown by the renderer (`WindowChannel.Show`/`Hide`), never on
  `ready-to-show`, so a cold start never flashes an empty IDE; a main-process timer shows it anyway
  if the renderer never speaks for it, retired the moment it does. Two related traps: **maximizing a
  window that has not been shown SHOWS it** on macOS, so a persisted maximized state is applied when
  the window is first shown (`WindowManager.showWindow`), not when it is created; and a window paints
  its `backgroundColor` until its content arrives, so a modal passes the colour its panel will land
  on (`bgcolor` in the features) rather than flashing black.
- **Child-window lifetime has two traps**, both already sprung: `pagehide` fires when a child's
  initial `about:blank` load commits, so a close is only believed once `window.closed` agrees
  (`watchChildWindowClosed`, shared with pop-outs); and orphaned children are closed when the main
  window STARTS a load, never after it finishes — the incoming renderer opens its welcome window
  within milliseconds of booting, and cleaning up after that would take it with it.
- **The inline overlay survives as a fallback** for environments with no window opener (unit tests,
  headless runs), which is why `modal.html`/`modal.scss` still exist. It is not a supported
  presentation: nothing may rely on modal content being in the raising window's DOM. E2E drives
  modals through `modalWindow(app)` (`e2e/helpers.ts`), not through the main page.
- **The tab-scoped document-conflict prompt is not a modal** and stays in-document by ruling: it
  belongs to a tab's content area, not to the window.

### 4.13 Logging (structured, per-session)

Studio has an application-wide structured logging service (epic #395); its records populate the
**System Monitor** tool's per-session log audit and a per-session JSONL file. **New code is expected
to log** — this is not optional plumbing, it is how the running app is observed.

- **How to log.**
  - Main process: import the shared singleton — `import { logger } from '@shared/electron/logger'` —
    and call `logger.info/debug/trace/warn/error(source, message, ...details)`. There is exactly one
    instance; never `new Logger()`.
  - Renderer: inject the service — `private readonly log = inject(Log)`
    (`@shared/angular/services/log/log`) — and call `log.info/debug/trace/warn/error(...)` with the
    same shape.
- **Source (the "Where").** A stable component/service name, optionally `Name.method` —
  `'GitManager'`, `'TerminalManager.spawn'`, `'containers.view'`. Keep it stable; the audit filters on
  it.
- **Severity discipline (log like a production app):**
  - `trace` — fine-grained flow: notable operation entry/exit, per-item detail, IPC payloads.
  - `debug` — diagnostics for investigation: resolved paths, chosen config, cache hits, state
    transitions.
  - `info` — notable normal events: lifecycle, workspace loaded, container started, agent session
    created, file saved, build started/succeeded.
  - `warning` — recoverable or unexpected-but-handled: retry, fallback, missing optional resource,
    permission denied.
  - `error` — failures and **every caught exception**.
- **Exceptions are always logged as errors.** Every `catch` that handles a real failure logs
  `logger.error(source, 'what failed', error)` (or `log.error`). The `Error`'s stack is preserved in
  the record — pass the error object as the last argument, don't stringify it. This complements §7
  Error handling: catch, narrow, **log the error**, then rethrow/handle.
- **Global safety net (already wired).** Main-process `uncaughtException`/`unhandledRejection` are
  logged as errors in `main.ts`; renderer uncaught errors/rejections reach the audit through Angular's
  `provideBrowserGlobalErrorListeners()` → `ErrorHandler` → console (captured by the
  `ConsoleForwarder`). Don't swallow errors silently anywhere.
- **No raw `console.*` in new code.** Use the logger. The `ConsoleForwarder` captures renderer
  `console.*` as a baseline (coarse `console` source), but **main-process `console.*` is not captured
  at all** — main code must use `logger`. Logging never throws (the API swallows its own failures), so
  it is always safe to call.
- **Instrument meaningful events, not every line** — the test is "would an operator want this row in
  the audit?".

### 4.14 Local model runtimes (the AI Model Manager)

The **AI Model Manager** tab (epic #407) owns the _local model lifecycle_: installing the runtime,
starting and stopping its server, and pulling, inspecting and removing model weights. Ollama is the
first — and currently only — implementation.

- **The seam is `ModelRuntime`** (`shared/electron/contributions/model-runtime/model-runtime.ts`): a
  provider slot covering status, the installed/running/inspect/remove reads, `pull`, and the server
  lifecycle (`installation`, `install`, `start`, `stop`, `diskUsage`). A second runtime is a new
  implementation plus a line in the contribution's factory; nothing upstream changes. The view reads
  its heading from the runtime's `displayName`, so it never names Ollama.
- **Everything is absent-safe by contract.** A query against a runtime whose server is not running
  resolves to an empty result, a `null`, or an unavailable status — never a throw. "Not running" is an
  ordinary state the manager renders, not an error; it is the state the user opened the tab to fix.
- **Detection prefers a system install** (`OLLAMA_EXECUTABLE` → PATH → platform locations) over
  Studio's managed copy, so a user who already runs the runtime never downloads a second one. The
  managed path mirrors `LspProvisioner`: pinned version, hard-coded SHA-256, version-scoped directory.
- **Studio only stops a server it started.** One the user is running is reachable but not ours to
  kill; `ModelRuntimeStatus.startedByStudio` is how the view knows to disable the control rather than
  offer one that silently does nothing. A spawned server is registered with the pid journal.
- **Status is polled, not watched** — Ollama has no event stream — but only while a view is
  subscribed (ref-counted, as System Monitor does with sampling) and pushed only on genuine change.
- **The catalogue** (`ModelCatalog`) is a source slot in the shape of the package-management
  registries: a bundled, offline curated list plus live Hugging Face search. Source failures are
  isolated and named, so losing the network degrades the list rather than emptying it.
- **The boundary with connections (#254) is deliberate and load-bearing.** This feature owns the
  runtime and the weights; connections own endpoint config, auth, and which model ids reach the agent
  picker. `ModelConnections` is the only crossing: it writes a pulled model's id (and its real context
  window from `/api/show`) into local Ollama connections, and removes it again on delete. It acts only
  on explicit installs and removes, never as a background sweep, so it cannot undo a user's own
  picker edits.

### 4.15 API documents (the API Explorer's file)

The API Explorer tab is a **document**, and its document is a file: `*.api.json`, holding the
environments, collections and requests of one API workspace (`ApiDocument`, in the shared API
contract). Two things identify it, and both matter:

- **The name suffix routes it.** `FileOpener` sends a `*.api.json` to an API Explorer tab, the way it
  sends a `.md` to the markdown editor. Only the name is consulted, so routing costs nothing — a plain
  `.json` file is never touched.
- **The moniker inside verifies it.** `ApiFiles.parse` requires `"kind": "onixlabs.studio.api"` and a
  version this build can read. A `*.api.json` that is someone else's schema, malformed, or from a
  newer Studio is **declined**, and the opener falls through to the text editor — which is where a
  user needs to be to fix it. A file is never half-loaded.

`ApiFiles` is the shell-side seam, the direct analog of `Workspaces` for directory tabs: it opens (or
re-activates) the tab and stashes the parsed document under its id for the view to consume once on
init. It names no feature — it opens a tab type the shell already knows.

**The workspace has two modes, and the difference is where edits go.** Untitled, it auto-saves to the
session store on every edit, so a scratch workspace survives a restart and never prompts — there is no
file for it to be out of step with. Bound to a file, the file is the only thing that matters: edits
mark the document dirty, the tab wears the dot, Save writes it, and the view registers with
`UnsavedWorkRegistry` so closing the tab or the window asks first. Save As appends the suffix when the
user does not type it (replacing a bare `.json`), so a saved document is always one that can be opened
again.

---

## 5. AI agent — access & permission model

How Studio bounds what an AI agent can see and do. Enforcement lives in the main process
(`src/shared/electron/ai/*`); the renderer runtime is `src/shared/angular/services/ai-runtime`.

**Providers & connections.** Providers are **data, not code**. A user-editable list of
**connections** (`AiConnection`: id, kind, label, base URL, auth kind, model list) is persisted in
settings and managed in the AI settings section; the built-in seeds (Claude, an Anthropic API-key
connection, and a local Ollama) can be extended with any OpenAI-compatible, xAI, Google, DeepSeek, or
custom endpoint without new code. Three provider implementations back them, dispatched on the
connection's **auth kind**: `ClaudeAgentProvider` (the Claude Agent SDK, local-login path) for a
`claude-login` connection, `CodexAgentProvider` (OpenAI Codex via `@openai/codex-sdk`) for a
`codex-login` connection, and the generic `AiSdkAdapter` (Vercel AI SDK, dispatched by kind + base URL)
for every other. The renderer passes its
connections to `AiManager.listProviders`, which **rebuilds** its provider set from them, so a user's
own connection is immediately runnable; `AgentEngine` owns the active connection + per-connection
model selection.

**Authentication.** Each connection resolves its own credential, keyed by connection id, through an
`AuthStrategy` (`api-key` / `none` / `claude-login` / `codex-login`; OAuth is a future drop-in). A
`claude-login` connection uses the user's **local Claude login** (`~/.claude`, the same credential
Claude Code uses) and a `codex-login` connection the user's **local Codex login** (`~/.codex`) —
independent probes; an `api-key` connection uses a per-connection **API key** stored encrypted at rest
via OS
secure-storage (`safeStorage`, in `AiAuthManager` over a pure `CredentialStore`). Keys **never cross
the contextBridge**; only narrow per-connection status, config, and run-control calls are exposed. A
key stored by a pre-connections build migrates onto the built-in Anthropic API-key connection.

**Scope of a run.** The working directory is the open workspace root (or the user's home when none is
open) — never Studio's install directory. Every run is cancellable; aborting **interrupts** the current
turn — a held-open live session survives for the next turn (see _Session lifecycle_ below) — and denies
any pending permission prompt.

**Write confinement.** When a workspace is open, a granted file write (`Write`/`Edit`/`MultiEdit`/
`NotebookEdit`) is refused if its target resolves outside the workspace root — a **hard boundary that
approving the action cannot widen** (a prompt authorises _what_ an action does, not _where_; a single
click must not be able to escape the root). Widening the allowed area is a **configuration** decision,
not a per-prompt override: settings carry **allowed write paths** (extra directories the agent may
write to) and **denied write paths** (paths it may never write to — an absolute path or a bare segment
like `.git`/`.env` — a sharper guard applied even inside an allowed root). `Bash` writes cannot be
range-checked from the command text, so they are backed by the SDK OS sandbox instead (enabled,
degrading gracefully where unavailable) — the deny list therefore guards the file-write tools, not
`Bash`. A no-workspace (home) run is root-unconfined but still honours the deny list. Confinement is
evaluated before the posture, so it holds even under an auto-allowing posture.

**Network confinement.** The agent's egress is bounded by the same widen/narrow pair, in a different
medium: **allowed network locations** (host patterns — `api.example.com`, `*.corp.example`; empty
means anywhere, so the setting is opt-in) and **denied network locations**, which win over the
allowed list. Patterns match **the sandbox's way, label for label**: `*.example.com` covers
`api.example.com` but not `deep.api.example.com`, the wildcard lives in the leftmost label only, and
`*` and `*.com` are refused as too broad (where they are typed, not silently on the way out). One
convenience is layered on top — a wildcard is taken to include its apex — and it is _expanded_ into
the list handed to the sandbox rather than matched loosely here, so both enforcement points answer
the same question the same way. Note `github.com` and `api.github.com` are different hosts to both:
allowing a site does not allow its API. Cloud-metadata addresses (`169.254.169.254`, `metadata.google.internal`) are refused
whatever is configured — unauthenticated role credentials one request away — while loopback is
deliberately _not_, because testing a local service is what the API Explorer is for. Two enforcement
points, and the difference matters:

- **The OS sandbox** carries the lists as `sandbox.network.allowedDomains`/`deniedDomains`, which is
  what reaches `Bash` and the SDK's own web access — the paths `canUseTool` cannot see, because a gate
  reads a tool's arguments and a sandbox sees syscalls. The same call now also carries the write
  paths as `sandbox.filesystem.allowWrite`/`denyWrite`, so the deny list finally covers shell writes
  as well as the file-write tools. Only _absolute_ deny entries go over: a bare segment like `.git` is
  a gate pattern and would be meaningless as a sandbox path.
- **The API tools** are checked in the renderer before a send leaves (`ApiWorkspace.send(id,
'agent')`). A user's own send is never checked — the view exists to point at any endpoint you like;
  the setting names what the _agent_ may reach.

**Codex has one network switch, not a host list**, so a non-empty allow list fails closed there: the
user asked for _these_ hosts and the provider can only offer all or none. Sandbox availability is
still graceful (`failIfUnavailable: false`), which means a machine missing the platform sandbox runs
unconfined — the network list then applies only to the API tools.

**Tool permissions (machine).** Built-in tools are gated in main through the Agent SDK's `canUseTool`
hook. Three layers decide, in order: **write confinement** (above) refuses out-of-root writes
outright; the user's **per-tool policy** is consulted next; the **permission posture** decides the
rest.

- **Per-tool policy** — a user default of `allow` / `ask` / `deny` per gateable tool (set in AI
  settings, keyed by tool display name). `deny` refuses even when the posture would auto-allow; `allow`
  runs without prompting (still subject to confinement); `ask` (the default) defers to the posture.
- **Permission posture** — `prompt` (ask before every mutating/exec tool), `auto-edits` (also
  auto-allow file edits), or `auto-all` (auto-allow everything).

| Tool class      | Examples                | Default (posture `prompt`, policy `ask`) |
| --------------- | ----------------------- | ---------------------------------------- |
| Read-only       | `Read`, `Glob`, `Grep`  | **Auto-allowed** within the run.         |
| Mutating / exec | `Edit`, `Write`, `Bash` | **Ask the user** before each use.        |

A gated tool calls `requestPermission(name, detail)`; `AiManager` emits a `permission` event (tool +
one-line summary including the target path/command); the renderer surfaces an inline Allow/Deny
prompt; the tool runs only on explicit Allow. A `deny` policy is enforced by removing the tool from the
model via the SDK's `disallowedTools`, **not only at the gate**: the Claude Code CLI auto-runs shell
commands its own safety classifier deems safe (e.g. `echo`) without consulting `canUseTool`, so a
gate-only deny would leak them.

**Audit log.** Every _executed_ mutating/exec action is appended to a best-effort, size-bounded JSONL
log under userData (`AgentAuditLog`): tool, one-line target, workspace root, timestamp, and a coarse
grant source (`policy` / `posture` / `gated-or-auto`). Auditing happens at the **execution point** — a
`PostToolUse` hook on the Claude path, the `gated` wrapper on the AI-SDK path — so commands the CLI
safety classifier auto-runs (without the `canUseTool` gate) are captured too; denials never execute so
they are not logged, and read-only / in-app tools are skipped. The exact grant path is not
distinguishable at execution, hence the coarse source.

**In-app capabilities.** The agent can also act inside the app (e.g. read/replace the live editor
document) via the renderer capability registry: providers call `context.bridge.request(capability,
input)`, correlated over `RendererBridge` to a handler registered on `AiRuntime`. Only registered
capabilities are reachable; unknown names are rejected. (`AgentEditorCapabilities` in `features/agent`
registers read/replace-active-document, preferring the markdown editor then the code editor.)

**Session lifecycle (live-harness vs stateless).** A provider is one of two _shapes_
(`AgentProvider.sessionModel`). A **live-harness** provider — the Claude Agent SDK or OpenAI Codex — is
an external agentic runtime driven as a subprocess that owns its own loop, tools, and session, so Studio
holds **one session open per conversation** and pushes each turn into it. A **stateless-model** provider
— the `AiSdkAdapter` over OpenAI / Ollama / … — has no live process; its "session" is the transcript
replayed each call, so every turn is independent. Both sit behind the same `AgentSession` seam
(`turn` / `interrupt` / `close`) and look identical to the renderer (an agent with history).

The two live-harnesses differ under the seam. **Claude** holds one streaming `query()` subprocess open
across turns and enforces confinement through a per-tool `canUseTool` gate (plus its OS sandbox), so
Studio's permission posture, deny list, and audit log all apply. **Codex** (`CodexAgentSession` over
`@openai/codex-sdk`) is a `Thread` whose each `runStreamed` turn resumes the persisted thread
(`~/.codex/sessions`) — no subprocess is held between turns, so `close`/reap are cheap — and it exposes
**no per-tool callback**: confinement is enforced purely by the harness **sandbox**
(`sandboxMode: 'workspace-write'` scoped to the workspace root plus the allowed write paths;
`'read-only'` in chat mode), consistent with the hard-boundary ruling (Decision 5) but meaning the deny
list, audit log, and interactive per-tool prompts do **not** apply to Codex — the sandbox is the
boundary. Both keep context across turns and reopen via resume after reap/restart; a Codex model change
takes effect on the next fresh session (the SDK has no per-thread model swap).

On the Claude live path (`ClaudeAgentSession`), `AiManager` keys held-open sessions by a renderer-minted
**`agentSessionId`** — stable per conversation, _not_ the SDK session id (which avoids a
before-id-known race and decouples routing from resume). A turn for a known conversation continues its
session; the SDK `result` message ends a **turn**, not the session. The session's options split in two:

- **Frozen at open** — bound once into the subprocess: the working directory, the surface/mode-scoped
  MCP tool set, allowed / `disallowedTools`, the OS sandbox, the system prompt, resume, env, and the
  opening model. A later turn that changes a field these derive from (provider, surface, workspace,
  mode, agent shell) is **incompatible** — the router closes the session and reopens a fresh one.
- **Per turn** — the in-app tool handlers, `canUseTool`, and the audit hook read the **current** turn's
  context, so each turn's permission gate, audit sink, request id, bridge, posture, and policies apply.
  A model change is applied live via `Query.setModel`.

**Teardown.** Stop **interrupts** the current turn (the SDK ends it and the session stays live for the
next turn) — it does _not_ end the session. Only **New chat**, **closing the owning tab**, or app
shutdown closes it (the renderer drives `closeSession`; the session's master abort controller terminates
the subprocess). A turn whose stream fails evicts the session so the next turn opens fresh. A kill
switch (`LIVE_SESSIONS_ENABLED`) falls the whole path back to a transient open→one-turn→close per run.

**Reap & cold-start (#328).** A live session does not live forever. An idle session past
**`ai.agentSessionLifetime`** (Settings › AI: 30 min / 60 min / 1 day / indefinite) is reaped — its
subprocess closed — and a memory-pressure LRU valve caps how many sessions stay open at once
(`MAX_LIVE_SESSIONS`), applied **even under an indefinite lifetime** so held-open sessions can never
exhaust the machine (the actively-running session is never the victim — `lastActivity` is stamped at
turn start). On **app restart** the subprocess is gone entirely. Either way, reopening is
**transparent**: the next turn carries the conversation's persisted `resumeSessionId`, which
`dispatchLive` turns into a cold-start `openSession` that resumes the SDK session — so context is
preserved with only a small reconnect delay, no user action.

**Source of truth (store vs SDK session).** Two things persist, at different layers, joined by the
session id — not double storage. The **SDK** owns the model's live context and persists its own session
transcript on disk (resumed by id); **Studio's `AgentConversationStore`** persists the _displayed_
transcript (`items`), the `resumeSessionId`, and the pending `queue`. On restore, Studio rehydrates the
UI from `items` and hands the `resumeSessionId` to the next turn — the model re-reads its own session,
never Studio's items. So the store is authoritative for what the user _sees_; the resumed SDK session is
authoritative for what the model _remembers_.

**Capabilities & commands (#330).** Provider capabilities are **declared, then gated uniformly**. Each
provider states what it offers — `supportsImages` and `supportedEfforts` (the reasoning-effort levels:
Claude `low…max`, Codex `minimal…xhigh`, the stateless AI-SDK path none) — on `AgentProvider`, surfaced
to the renderer on `AiProviderInfo`. The composer reads the active provider's set to gate features: it
rejects image attach when unsupported, and shows `/effort <level>` (a per-conversation choice on the
`Agent`, clamped to the provider's range and applied at session open) only for providers that offer it.
**Live command discovery**: a live-harness session can be asked for its slash commands at any time —
`ClaudeAgentSession` calls `Query.supportedCommands()` on open and handles the `commands_changed` push,
emitting a `commands` event the composer merges into its `/` menu (minus app-native and a conservative
non-dispatchable deny-list). A picked command drops `/name ` into the draft and dispatches into the live
session as input. This is what the persistent-session work unlocked (it supersedes the deferred #322).

**Enforcement points:** `AiAuthManager` (credentials stay in main) · `ClaudeAgentProvider.canUseTool`
(confinement → per-tool policy → posture, plus `disallowedTools` for denials) · `ClaudeAgentSession`
(held-open query; frozen-at-open vs per-turn context indirection; interrupt-not-close) · `AiManager`
(permission broker, per-tool-policy sanitising, `AgentAuditLog`, the live-session registry + compatibility
router in `dispatchLive`, and idle-reap + the LRU valve) · `RendererBridge` + `AiRuntime` (in-app
capability surface).

---

## 6. Source control

Real VCS behind a **provider adapter** so other backends are a later, out-of-scope epic:

- **Renderer** (`src/shared/angular/services/`): `source-control/source-control-provider.ts` (the
  interface) · `git-provider.ts` (`GitProvider`, calls the bridge) · `git-output.ts` (pure,
  unit-tested parsers for status v2 / log / for-each-ref / stash / diff-tree) ·
  `source-control-providers.ts` (the adapter factory).
- **Per-tab state:** `repository/repository.ts` (`Repository` — the source-control tab: bind/refresh,
  selection, lazy commit files + diffs, stage/commit/stash/checkout/branch) · `workspace-git/` (the
  directory tab's lightweight status decorations, in `features/workspace`) · `repositories/`
  (`Repositories` handoff + `RepositoryOpener`) · `diffs/` (`Diffs` store + `DiffOpener`; diffs open
  in the document well).
- **Main** (`src/shared/electron/git-manager.ts`): runs the git CLI via `execFile` with array args,
  every operand validated and confined to an opened root; refcounted opened-roots map; network ops go
  through a non-interactive env + 120s timeout. Channels/types in `src/shared/api/source-control-channels.ts`.
- **UI** lives in `shared/angular/components/panels/` (the `source-control-view` + `commit-graph` /
  `commit-detail` / `source-control-sidebar` panels + `REPOSITORY_DOCK_BLUEPRINT`); the generic diff
  panels (`diff-view`, `diff-document-panel`) are shared.

**Unfinished operations** (merge/rebase/cherry-pick/revert) are state the panel can name, not just
failures. Three rules hold here, each of which has already cost a bug or would have:

- The state is read from `git rev-parse --absolute-git-dir`, never `<root>/.git` — a linked
  worktree's merge state lives elsewhere, and the naive join reports every worktree as idle.
  `classifyOperation` (pure, tested) decides the kind; rebase is tested **before** cherry-pick,
  since replaying a commit leaves the same markers.
- Merge, rebase, and the commands that finish them run through `runIntegration`, which sets
  `GIT_EDITOR`/`GIT_SEQUENCE_EDITOR`/`GIT_MERGE_AUTOEDIT`. **Without it git blocks on an editor that
  cannot open, and the timeout's kill lands mid-operation.** A non-zero exit is then re-probed:
  still in flight means `SourceControlCode.Conflicted`, which reloads without reporting an error.
- Continue/skip/abort read the operation git is _actually_ in rather than trusting the renderer, and
  a **squash merge is not a merge**: it records no `MERGE_HEAD`, so it aborts via `reset --merge` and
  cannot be continued at all.

Conflicted paths come from status v2's `u` entries into `ParsedStatus.conflicted`, kept out of
staged/unstaged: staging one is what marks it resolved. Their diff is `:2:path` (ours) against the
worktree, because `:path` is ambiguous for an unmerged path.

The source-control tab **opens a repository**; the directory tab gets **lightweight** git (status
decorations + a few ops). `Tab.resourceKey` + `Tabs.findByResource` keep a resource single-instance
per tab type, so open flows focus an existing tab instead of duplicating.

---

## 7. Coding conventions

Three rules are mandatory and mechanically enforced; the rest elaborates on them.

1. **Object-orientation first.** Favour OOP; reach for FP only where it expresses the problem better.
2. **Explicit member accessibility.** Every class member is explicitly `public`/`protected`/`private`.
3. **Explicit, total type annotations.** Annotate every type — members, parameters, return types,
   **and local variables**. `any` is forbidden.

### Paradigm — OOP first, FP where it fits

Model the domain with classes, interfaces, and clear responsibilities. Use functional techniques when
they read better: pure functions for stateless transforms; array methods (`map`/`filter`/`reduce`)
over manual loops where clearer (mind allocation on hot paths — justify a manual loop with `// Why:`);
signals for reactive state. Don't force a paradigm: a stateless single-method class is usually a
function; free functions sharing mutable state are usually a class.

### Type safety

- **Annotate everything**, including locals, even where inferrable — annotations are documentation and
  a guard against inference drift: `const retryLimit: number = 5;`.
- **`any` is forbidden.** Use `unknown` and narrow explicitly.
- **`null` vs `undefined`:** prefer `undefined` for "absent"; reserve `null` for intentionally-empty
  values and interop. Never silently return `null`/`undefined` to signal failure.
- **Immutability by type:** `readonly`, `readonly T[]`, `Readonly<T>`, `as const`.
- **Prefer narrow types:** union literals and discriminated unions over loose `string`/`number` and
  boolean state flags.

### Access modifiers

- Every member carries an explicit modifier; start at `private` and widen only for a real consumer.
- Mark `readonly` wherever not reassigned after construction.
- **Never prefix private members with an underscore** (`private name`, not `private _name`) — `this.`
  already disambiguates.
- **Template-bound component members are `protected`**, not `public` — they are the template contract,
  not public API. `private` members are not template-accessible.
- Use `#private` JS fields only for hard runtime privacy (e.g. secrets in the main process).

### Naming

- Intention-revealing, pronounceable, searchable names. Classes are nouns (`WindowManager`); methods
  and functions are verbs (`createWindow`); booleans read as predicates (`isActive`, `hasChildren`).
- No misleading names (don't call a `Map` a `list`). No `I`-prefix on interfaces. No Hungarian /
  type-encoding prefixes.
- **Casing:** `PascalCase` (classes, interfaces, type aliases, enums, decorators, enum members);
  `camelCase` (methods, functions, properties, variables, parameters); `UPPER_SNAKE_CASE` (genuine
  compile-time global constants); `kebab-case` (file names).

### Classes, functions & structure

- **Single Responsibility**; **stepdown rule** (public API first, private helpers below, each one
  level of abstraction beneath the last); **composition over inheritance** (inject collaborators);
  prefer fully-initialised `readonly` objects over mutable-with-setters.
- **File-level SRP** — a file holds one primary responsibility; **no file crosses ~500 LOC / ~5
  responsibilities without decomposition**. Extract pure transforms into free-function modules and
  stateful collaborators into injected classes (with `dispose()` only where there is per-instance
  lifecycle to tear down), keeping the original type a thin orchestrator that forwards to them; reuse
  shared atoms/wrappers rather than re-implementing.
- Functions are **small and focused** (~≤20 lines, one thing, one level of abstraction) with **0–2
  parameters** (three or more → a parameter/options object).
- **Explicit return types on every function and method**, including `void`/`Promise<void>`.
- **No unintended side effects** — a query must not mutate. Prefer `async`/`await`; **never leave a
  floating promise** (await it, return it, or mark it handled); surface cancellation via `AbortSignal`.
- **Ship no dead code** — no stub/seed data on production paths, no editable setting without a reader,
  no unreferenced exports. Add a control/feature only with the code that consumes it. (Commented-out
  code and untracked `TODO`s are covered under _Comments_ below.)

### Error handling

- **Throw errors, don't return codes.** Throw `Error` or a domain subclass:
  `class CustomerNotFoundError extends Error { … this.name = 'CustomerNotFoundError'; }`.
- Don't silently return `null`/`undefined` for failure — throw, or make absence explicit in the type
  and document it. Scope resources with `try/catch/finally`. For expected non-exceptional failure a
  result type (`{ ok: true; value } | { ok: false; error }`) is acceptable — used deliberately.
- Catch `unknown` and narrow (`catch (error: unknown) { if (error instanceof DomainError) … }`).
- **Log every caught exception as an error** — `logger.error(source, 'what failed', error)` (main) or
  `log.error(...)` (renderer), passing the error object so its stack survives. Never swallow an error
  silently. See §4.13 Logging.

### Documentation (TSDoc)

**Every member is documented — regardless of visibility**, in genuine descriptive prose (capitalised,
ending with a period, never placeholder). Reference symbols with `{@link Symbol}`. Opening phrases are
conventional and carry meaning:

| Member                           | Opening phrase                                              |
| -------------------------------- | ----------------------------------------------------------- |
| Class                            | `Represents …`                                              |
| Interface / type / function-type | `Defines …`                                                 |
| Enum                             | `Specifies …`                                               |
| Constructor                      | `Initializes a new instance of the {@link TypeName} class.` |
| Read-only property/accessor      | `Gets …`                                                    |
| Write-only accessor              | `Sets …`                                                    |
| Read/write property/accessor     | `Gets or sets …`                                            |
| Boolean property                 | `Gets a value indicating whether …`                         |
| Method                           | A verb phrase describing the action                         |

Required tags: `@param` per parameter; `@returns` (text begins with "Returns") for every non-`void`
return; `@typeParam` matching each generic; `@throws {@link ErrorType}` per throwable. Avoid empty
tags and identical summaries across unrelated members.

### Comments (non-documentation)

Rare — prefer rewriting unclear code over explaining it. A comment explains **why**, never **what**;
lead performance/correctness choices with `// Why:`. No commented-out code (version control is the
history). No `TODO` without a tracked issue (`// TODO(#123): …`).

### Formatting

Line length **100** (`printWidth: 100`). One statement / declaration per line. Single quotes,
semicolons, trailing commas — never hand-format against Prettier. Import order: external packages,
then internal modules, then relative; no unused imports. Break long fluent chains one operator per
line.

### Angular conventions

- **Standalone components only** (no `NgModule`s); declare deps in `imports`.
- **Signals are the default** — `signal()` (state), `computed()` (derived; synchronous, memoised,
  glitch-free — do **not** hand-wire derived values through RxJS), `effect()` (reactive side effects).
  The app is **zoneless** — do not depend on Zone.js. Reach for RxJS only for genuine async _streams_
  (debounced input, IPC feeds) and unavoidable `Observable` interop, bridged back to signals with
  `toSignal()`; never leak a manual subscription.
- **`ChangeDetectionStrategy.OnPush`** on every component. **DI via `inject()`**, not constructor
  params. **Signal inputs/outputs** (`input()`, `input.required()`, `output()`, `model()`,
  `viewChild()`). **Built-in control flow** (`@if`/`@for`/`@switch`; always `@for … track`).
- `@Service()` (the project's `providedIn: 'root'` decorator) for singleton services. Component
  selectors `app-` + `kebab-case`. **Services hold logic; components orchestrate** (keep components
  thin).
- Because the app is zoneless, `NgZone.run`/`runOutsideAngular` are effectively identity; some ported
  code still calls `zone.run` defensively — **preserve it on relocation** rather than stripping it.

### Electron conventions

Security is a first-class quality concern; the process model stays strictly separated.

- **Process separation:** `src/shared/electron/main.ts` (Node) and `preload.ts` (bridge) are trusted;
  the Angular renderer is **untrusted** and sandboxed.
- **Locked-down `webPreferences`:** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true` — mandatory, never relaxed.
- **Expose a minimal API via `contextBridge`** — the generic `window.bridge` (`invoke`/`send`/`on`) +
  `window.host`. **Never expose `ipcRenderer` or any Node API** to the renderer.
- **Validate every IPC payload in main** before acting — treat all renderer input as hostile. Prefer
  `ipcMain.handle`/`invoke` (request/response) over fire-and-forget `send`. Name channels by domain
  (`project:open`, `window:minimize`) in the per-domain `*-channels.ts` enums.
- **Restrict navigation and window creation** (`will-navigate`, `setWindowOpenHandler`); set a
  Content-Security-Policy; never load remote untrusted URLs into a privileged renderer.

### Testing (Vitest)

- **TDD by default**; **F.I.R.S.T.** (Fast, Independent, Repeatable, Self-validating, Timely).
- **Arrange / Act / Assert** separated by blank lines; **one logical assertion per test**.
- Name tests `method_condition_expectation`
  (`load_whenCustomerMissing_throwsCustomerNotFoundError`). **Test behaviour through the public API.**
  Async tests `await`; cover documented contracts including error paths.

---

## 8. Build, test & tooling

### Commands

| Task                      | Command                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Dev server (renderer)     | `ng serve`                                                                                         |
| Renderer production build | `ng build`                                                                                         |
| Electron main + preload   | `npm run build:electron` (`tsc --noEmit` typecheck → esbuild `main` + `preload`)                   |
| Tests                     | `CI=true ng test --watch=false`                                                                    |
| Coverage (thresholds)     | `npm run test:coverage` — enforces the minima in `angular.json` `coverageThresholds`               |
| E2E (Playwright)          | `npm run e2e` — drives the built Electron app; build first (`ng build` + `npm run build:electron`) |
| Lint / format             | `npm run lint` (`eslint .`) · `npm run format` (Prettier)                                          |

### The green gate (run before every commit)

`ng build` + `npm run lint` + `npm run format:check` + `npm run build:electron` +
`CI=true ng test --watch=false`. Everything is green from a clean checkout — there is no tolerated
baseline of failures or prettier warnings. GitHub Actions (`.github/workflows/ci.yml`) enforces the
same gate on every PR and on `main`. **Green after every commit:** if a step can't stay green, it's
too big — split it.

### Toolchain facts & gotchas

- **node-pty is rebuilt for the Electron ABI on every install** — the `postinstall` hook runs
  `electron-rebuild --only node-pty` (scoped deliberately: rebuilding everything caused problems).
  electron-builder rebuilds again at package time, and the CI `pack` job verifies the asar-unpack.
- **No `baseUrl`** (TS5090) — alias targets in `tsconfig.json` `paths` must be relative (`src/...`).
- **`tsc` does not rewrite path aliases in emit.** The electron main is **esbuild-bundled** (like
  preload): `--packages=external --tsconfig=tsconfig.json`, so `@shared`/`@features` resolve at
  runtime; `tsc --noEmit` is typecheck-only. The build output stays at `dist-electron/electron/` (the
  esbuild `outfile`) so `__dirname`-relative paths in `main.ts` are stable. Renderer bootstrap
  (`src/shared/app`, `src/shared/angular`) is **excluded** from the electron tsconfig — it is
  Angular/renderer code the node build must skip.
- **`styleUrl` can't use aliases** (Angular). When a component with a shared `styleUrl` moves, inline
  the rule into its own `.scss` (the shared ribbon-row `:host` block is inlined per migrated ribbon
  for this reason).
- **Barrels re-exporting types** need `export type { … }` (isolatedModules / TS1205).

### The relocation recipe (behaviour-preserving moves)

Moving a directory/service to `@shared` or a feature is relocation, not a rewrite — do **not** refactor
logic or rename for taste while moving. In order:

1. `git mv <src-dir> <dest-dir>` — move the **whole directory** so internal `./sibling` imports survive.
2. Fix the moved files' own up-paths (a relocated `from '../../../shared/X'` silently retargets wrong):
   `sed -E -i '' "s#from '(\.\./)+shared/#from '@shared/#g"` across the moved files.
3. Repoint importers with a **sibling-safe** pattern that catches both `../X/X` and `services/X/X`:
   `grep -rlE "from '[^']*/<dir>/<base>'" src`. It does **not** catch same-dir `./X` — repoint those
   explicitly when splitting a directory. Also grep **inbound** edges (the selector `app-<x>-view` and
   the class import), not just the moved unit's own imports.
4. `prettier --write` the touched files; run the green gate.

Standing a feature up adds: gate-check its dependency cone → promote any foreign kitchen deps to
`@shared` first → sever cross-feature embeds → relocate to `src/features/<f>/angular` → write
`<f>.feature.ts` → add one line to `config.ts` → delete its `@case` (if any) from the shell. Splittable
into relocate-then-flip commits.

### If you drive the Bash tool (it runs zsh)

- **`path` is a reserved zsh var** tied to `$PATH` — `for path in …` clobbers `$PATH` and every
  external command then fails "command not found". Never loop with `path`/`fpath`/`cdpath`/`manpath`;
  use `p`/`f`/`svc`.
- **zsh does not word-split unquoted `$var`** — `for f in $(grep -rl …)` runs once with the whole
  blob. Iterate via `grep … | while IFS= read -r f; do …; done`.
- **macOS BSD `sed` has no `\b`** (silently no-ops) — use plain `s/Old/New/g` for symbol renames.

---

## Pre-PR checklist

- [ ] Every class member has an explicit `public`/`protected`/`private` modifier.
- [ ] Every type annotated — members, parameters, return types, **and locals**. No `any`.
- [ ] OOP by default; FP only where it reads better. Names intention-revealing.
- [ ] Functions small, one thing, ≤2 params (or an options object). No floating promises; failures
      throw typed errors, never silent `null`/`undefined`.
- [ ] Every member — including `private` — has genuine TSDoc with the correct opening phrase.
- [ ] Comments explain _why_; no commented-out code; no untracked `TODO`s.
- [ ] No file crosses ~500 LOC / ~5 responsibilities without decomposition into modules/collaborators.
- [ ] No dead code shipped: no stub/seed data on production paths, no editable setting without a
      reader, no unreferenced exports.
- [ ] Angular: standalone, signals/`computed`, `OnPush`, `inject()`, `protected` template members,
      built-in control flow. Electron: `contextIsolation`/`sandbox` on, `nodeIntegration` off, narrow
      `contextBridge`, IPC validated.
- [ ] New/changed features respect the invariants: `shared` names no feature; a feature imports only
      `@shared`/`@features`; registry descriptor + one `config.ts` line.
- [ ] Tests follow AAA + FIRST, named `method_condition_expectation`, behaviour via public API.
- [ ] The green gate passes (no new failures, no new prettier warnings).
