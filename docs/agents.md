# ONIXLabs Studio — Agent Guide

The single source of truth for anyone (human or AI) working on **ONIXLabs Studio**, a TypeScript /
Angular / Electron desktop IDE. It covers the codebase architecture, the conventions your code must
follow, and how to build, test, and verify changes.

> **Code is clean if it can be read, and enhanced by a developer other than its original author.**
> Every line must justify its existence through clear naming and thorough documentation of _why_ it
> exists.

---

## 1. Stack at a glance

- **Angular 20, standalone + zoneless.** Signals are the reactive model; there is no Zone.js. A
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

### Kitchen vs recipe

`shared` is a kitchen stocked with reusable capability components, framework, atoms, cross-cutting
services, and the generic IPC transport. Features are recipes: a leaf view composes shared parts plus
its own ribbon / commands / status glue and its own `api`/`electron` surface.

### `shared/app` — the assembler

`src/shared/app` is a deliberately tiny sibling of `angular`/`api`/`electron`. It is the **only** code
allowed to name features, because it is the composition root:

- `config.ts` — the feature enumeration (seven `provide<F>Feature()` calls; `welcome` is mounted
  directly by `root`). This is the one place that lists features; delete a feature = delete its folder
  + remove its line here.
- `root/` — the `app-root` component that mounts the shell chrome + the active tab's view.
- `main.ts` — the Angular bootstrap. `global.d.ts` — the ambient `Window.bridge`/`host` types.
  `index.html` — the HTML entry.

---

## 3. Shared capability wrappers — the load-bearing contract

The kitchen's capability components are **thin wrappers around exactly one engine each** — no
splitter, no side panels, no ribbon, no embedded agent:

| Wrapper                 | Wraps                          | Backing plumbing (also in `shared`)                                  |
| ----------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `<app-terminal>`        | xterm (node-pty backend)       | pty api contract + electron terminal-manager + terminal-bridge       |
| `<app-text-editor>`     | Monaco                         | monaco service + `Editors` (model-URI → document registry)           |
| `<app-markdown-editor>` | Milkdown / ProseMirror         | milkdown service + plugins                                            |
| `<app-agent>`           | the agent chat UI              | agent-runtime / ai-auth / agent-sessions + the ai bridge             |

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

These four mechanisms are why a feature is a deletable plug-in. Know them before adding or changing a
feature.

### 4.1 Feature registry (tab views + ribbons)

`shared/angular/services/feature-registry` holds a multi-provider `FeatureRegistry` keyed by tab-type
string. Each feature contributes a descriptor:

```ts
interface FeatureDescriptor {
  readonly type: string; // the tab-type identifier and registry key, e.g. 'terminal'
  readonly view: Type<unknown>; // mounted per tab; MUST declare tabId + isActive inputs
  readonly ribbon?: Type<unknown>; // contextual ribbon shown while the tab is active
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

### 4.2 The dock (per-tab panel catalogue + layout)

`shared/angular/{services,components}/dock` is a generic docking framework that names no feature
panel. A tab specialises its dock by providing a `DockBlueprint` via the `DOCK_BLUEPRINT` injection
token: `createLayout()` returns the initial `DockNode` tree, and `panels[]` is the catalogue the
`DockPanelRegistry` seeds from. The workspace tab provides `WORKSPACE_DOCK_BLUEPRINT`, the repository
tab `REPOSITORY_DOCK_BLUEPRINT` — each cataloguing its own feature panels. `defaultLayout()` (pure ID
strings) stays in the dock; the panel _components_ are contributed by the blueprint.

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

---

## 5. AI agent — access & permission model

How Studio bounds what an AI agent can see and do. Enforcement lives in the main process
(`src/shared/electron/ai/*`); the renderer runtime is `src/shared/angular/services/ai-runtime`.

**Authentication.** The agent authenticates from the user's **local Claude login** (`~/.claude`, the
same credential Claude Code uses) or, as a fallback, a user-supplied **API key** stored encrypted at
rest via OS secure-storage (`safeStorage`, in `AiAuthManager`). The key **never crosses the
contextBridge**; only narrow status, config, run-control, and verification calls are exposed.

**Scope of a run.** The working directory is the open workspace root (or the user's home when none is
open) — never Studio's install directory. Every run is cancellable; aborting stops the underlying
agent process and denies any pending permission prompt.

**Tool permissions (machine).** Built-in tools are gated in main through the Agent SDK's `canUseTool`
hook:

| Tool class      | Examples             | Policy                                  |
| --------------- | -------------------- | --------------------------------------- |
| Read-only       | `Read`, `Glob`, `Grep` | **Auto-allowed** within the run.       |
| Mutating / exec | `Edit`, `Write`, `Bash` | **Ask the user** before each use.     |

A gated tool calls `requestPermission(name, detail)`; `AiManager` emits a `permission` event (tool +
one-line summary including the target path/command); the renderer surfaces an inline Allow/Deny
prompt; the tool runs only on explicit Allow.

**In-app capabilities.** The agent can also act inside the app (e.g. read/replace the live editor
document) via the renderer capability registry: providers call `context.bridge.request(capability,
input)`, correlated over `RendererBridge` to a handler registered on `AiRuntime`. Only registered
capabilities are reachable; unknown names are rejected. (`AgentEditorCapabilities` in `features/agent`
registers read/replace-active-document, preferring the markdown editor then the code editor.)

**Enforcement points:** `AiAuthManager` (credentials stay in main) · `ClaudeAgentProvider.canUseTool`
(allow-list vs ask) · `AiManager` (permission broker) · `RendererBridge` + `AiRuntime` (in-app
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
- **UI** lives in `features/repository` (the `source-control-view` + `commit-graph` / `commit-detail`
  / `source-control-sidebar` panels + `REPOSITORY_DOCK_BLUEPRINT`); the generic diff panels
  (`diff-view`, `diff-document-panel`) are shared.

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
- Functions are **small and focused** (~≤20 lines, one thing, one level of abstraction) with **0–2
  parameters** (three or more → a parameter/options object).
- **Explicit return types on every function and method**, including `void`/`Promise<void>`.
- **No unintended side effects** — a query must not mutate. Prefer `async`/`await`; **never leave a
  floating promise** (await it, return it, or mark it handled); surface cancellation via `AbortSignal`.

### Error handling

- **Throw errors, don't return codes.** Throw `Error` or a domain subclass:
  `class CustomerNotFoundError extends Error { … this.name = 'CustomerNotFoundError'; }`.
- Don't silently return `null`/`undefined` for failure — throw, or make absence explicit in the type
  and document it. Scope resources with `try/catch/finally`. For expected non-exceptional failure a
  result type (`{ ok: true; value } | { ok: false; error }`) is acceptable — used deliberately.
- Catch `unknown` and narrow (`catch (error: unknown) { if (error instanceof DomainError) … }`).

### Documentation (TSDoc)

**Every member is documented — regardless of visibility**, in genuine descriptive prose (capitalised,
ending with a period, never placeholder). Reference symbols with `{@link Symbol}`. Opening phrases are
conventional and carry meaning:

| Member                           | Opening phrase                                              |
| -------------------------------- | ---------------------------------------------------------- |
| Class                            | `Represents …`                                             |
| Interface / type / function-type | `Defines …`                                                |
| Enum                             | `Specifies …`                                              |
| Constructor                      | `Initializes a new instance of the {@link TypeName} class.`|
| Read-only property/accessor      | `Gets …`                                                   |
| Write-only accessor              | `Sets …`                                                   |
| Read/write property/accessor     | `Gets or sets …`                                           |
| Boolean property                 | `Gets a value indicating whether …`                        |
| Method                           | A verb phrase describing the action                        |

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

| Task                        | Command                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| Dev server (renderer)       | `ng serve`                                                                     |
| Renderer production build   | `ng build`                                                                     |
| Electron main + preload     | `npm run build:electron` (`tsc --noEmit` typecheck → esbuild `main` + `preload`) |
| Tests                       | `CI=true ng test --watch=false`                                               |
| Lint / format               | `npm run lint` (`eslint .`) · `npm run format` (Prettier)                      |

### The green gate (run before every commit)

`ng build` + `eslint src` + `prettier --check 'src/**/*.ts'` + `npm run build:electron` +
`CI=true ng test --watch=false`. There is a **known baseline of pre-existing failures** — treat "no
_new_ failures and no new prettier warnings" as green; don't chase the baseline. **Green after every
commit:** if a step can't stay green, it's too big — split it.

### Toolchain facts & gotchas

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
- [ ] Angular: standalone, signals/`computed`, `OnPush`, `inject()`, `protected` template members,
      built-in control flow. Electron: `contextIsolation`/`sandbox` on, `nodeIntegration` off, narrow
      `contextBridge`, IPC validated.
- [ ] New/changed features respect the invariants: `shared` names no feature; a feature imports only
      `@shared`/`@features`; registry descriptor + one `config.ts` line.
- [ ] Tests follow AAA + FIRST, named `method_condition_expectation`, behaviour via public API.
- [ ] The green gate passes (no new failures, no new prettier warnings).
